import {
  collection,
  doc,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  deleteField,
  type Firestore,
} from "firebase/firestore";
import {
  catalogLegacyAssets,
  resolveAsset,
  sceneAssetKeys,
} from "../../features/assets/catalog";
import { seedProject } from "../../features/project/migrations";
import {
  scopeKey,
  volumeKey,
  worldKey,
  type ItemKind,
  type ProjectRecord,
  type ProjectSnapshot,
} from "../../features/project/model";
import {
  validateProject,
  validateRecord,
  validateScene,
  object,
} from "../../features/project/validation";

/** Stable comparison also protects legacy documents which have no revision field. */
export function fingerprint(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .filter(([key]) => key !== "updated_at")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, sort(entry)]),
      );
    return v;
  };
  return JSON.stringify(sort(value));
}
export function encodeRecord(record: ProjectRecord): Record<string, unknown> {
  const { key: _key, generation: _generation, ...metadata } = record;
  if (record.kind === "scene") {
    const { scene: _scene, ...rest } = metadata as typeof metadata & {
      scene: unknown;
    };
    return JSON.parse(JSON.stringify({ ...record.scene, ...rest }));
  }
  return JSON.parse(JSON.stringify(metadata));
}
export function decodeRecord(
  raw: unknown,
  key: string,
  kind: ItemKind,
  world: string,
  volume: string | null,
  id: string,
): ProjectRecord {
  const data = object(raw);
  if (
    data.schema_version !== undefined &&
    ![1, 2].includes(Number(data.schema_version))
  )
    throw new Error(`Unsupported schema at ${key}. Source data was retained.`);
  const parent =
    kind === "world"
      ? null
      : kind === "volume"
        ? worldKey(world)
        : volumeKey(world, volume!);
  const common = {
    schema_version: 2,
    key,
    id,
    kind,
    world_id: world,
    volume_id: volume,
    name:
      data.name ??
      data.title ??
      (kind === "scene" && id === "main" ? "Main Scene" : id),
    parent_key: data.parent_key === undefined ? parent : data.parent_key,
    sort_order: data.sort_order ?? 0,
    revision: data.revision ?? 0,
    generation: 0,
    deleted_at: data.deleted_at ?? null,
    status: data.status ?? "draft",
  };
  let result: unknown;
  if (kind === "scene") {
    // Keep scene-specific extensions and entity fields, but do not put Firestore metadata into the scene payload.
    const sceneData = { ...data };
    for (const field of [
      "updated_at",
      "key",
      "id",
      "kind",
      "name",
      "parent_key",
      "sort_order",
      "revision",
      "generation",
      "deleted_at",
      "status",
    ])
      delete sceneData[field];
    result = { ...common, scene: validateScene(sceneData, world, volume!, id) };
  } else if (kind === "world")
    result = { ...common, unlock_level: data.unlock_level ?? 1 };
  else if (kind === "volume")
    result = {
      ...common,
      is_active: data.is_active ?? false,
      card_limit: data.card_limit ?? 20,
    };
  else if (kind === "mission")
    result = {
      ...common,
      description: data.description ?? "",
      starting_scene_id: data.starting_scene_id ?? null,
    };
  else if (kind === "asset")
    result = {
      ...common,
      url: data.url,
      storage_path: data.storage_path ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      size: data.size ?? null,
      mime: data.mime ?? null,
    };
  else result = common;
  return validateRecord(result);
}
export type SavedRecord = {
  key: string;
  generation: number;
  revision: number;
  base: string;
};
export type SaveResult = {
  saved: SavedRecord[];
  failures: { scope: string; message: string }[];
};
/** Connected dirty volumes share one transaction so new shared references never precede their assets. */
export function projectSaveGroups(
  project: ProjectSnapshot,
): { scopes: string[]; pending: ProjectRecord[] }[] {
  const scopes = new Map<string, ProjectRecord[]>();
  for (const key of project.dirty) {
    const r = project.records[key],
      scope = scopeKey(r);
    scopes.set(scope, [...(scopes.get(scope) ?? []), r]);
  }
  const parent = new Map([...scopes.keys()].map((k) => [k, k]));
  const root = (k: string): string => {
    const p = parent.get(k)!;
    return p === k ? k : root(p);
  };
  for (const pending of scopes.values())
    for (const r of pending)
      if (r.kind === "scene")
        for (const key of sceneAssetKeys(r.scene)) {
          const asset = project.records[key];
          if (asset?.kind === "asset" && scopes.has(scopeKey(asset))) {
            const a = root(scopeKey(r)),
              b = root(scopeKey(asset));
            if (a !== b) parent.set(a, b);
          }
        }
  const groups = new Map<
    string,
    { scopes: string[]; pending: ProjectRecord[] }
  >();
  for (const [scope, pending] of scopes) {
    const k = root(scope),
      group = groups.get(k) ?? { scopes: [], pending: [] };
    group.scopes.push(scope);
    group.pending.push(...pending);
    groups.set(k, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.scopes[0].split("/").length - b.scopes[0].split("/").length ||
      a.scopes[0].localeCompare(b.scopes[0]),
  );
}
export function cloudError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (
    code.includes("permission-denied") ||
    code.includes("unauthenticated") ||
    code === "storage/unauthorized"
  )
    return "Firebase denied access. Confirm studioAdmin: true, refresh your sign-in, and check the deployed rules.";
  if (
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code === "auth/network-request-failed" ||
    code === "storage/retry-limit-exceeded"
  )
    return "Firebase could not be reached. Your local drafts are retained; reconnect and retry.";
  if (
    [
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/user-not-found",
    ].includes(code)
  )
    return "Sign-in failed. Check your staff email and password.";
  if (code === "auth/too-many-requests")
    return "Sign-in is temporarily limited. Wait a little, then retry.";
  if (code.includes("not-found") || code.includes("failed-precondition"))
    return "Firebase service is unavailable or not provisioned. Check the project database configuration.";
  return error instanceof Error
    ? error.message
    : "Cloud operation failed. Local drafts were retained.";
}
export class FirestoreProjectRepository {
  constructor(private readonly db: Firestore) {}
  async load(): Promise<ProjectSnapshot> {
    const project = seedProject().project;
    const accept = (
      key: string,
      raw: unknown,
      kind: ItemKind,
      world: string,
      volume: string | null,
      id: string,
    ) => {
      project.records[key] = decodeRecord(raw, key, kind, world, volume, id);
      project.cloud_bases[key] = fingerprint(raw);
      project.dirty = project.dirty.filter((x) => x !== key);
    };
    const worlds = await getDocsFromServer(
      collection(this.db, "studio_worlds"),
    );
    for (const snap of worlds.docs)
      accept(snap.ref.path, snap.data(), "world", snap.id, null, snap.id);
    // The old editor saved scenes without creating parent documents: query known seeded volumes too.
    for (const world of Object.values(project.records).filter(
      (r) => r.kind === "world",
    )) {
      const volumes = await getDocsFromServer(
        collection(this.db, world.key, "volumes"),
      );
      for (const snap of volumes.docs)
        accept(
          snap.ref.path,
          snap.data(),
          "volume",
          world.id,
          snap.id,
          snap.id,
        );
      for (const volume of Object.values(project.records).filter(
        (r) => r.kind === "volume" && r.world_id === world.id,
      )) {
        for (const [collectionName, kind] of [
          ["folders", "folder"],
          ["missions", "mission"],
          ["assets", "asset"],
          ["scenes", "scene"],
        ] as const) {
          const documents = await getDocsFromServer(
            collection(this.db, volume.key, collectionName),
          );
          for (const snap of documents.docs)
            accept(
              snap.ref.path,
              snap.data(),
              kind,
              world.id,
              volume.id,
              snap.id,
            );
        }
      }
    }
    catalogLegacyAssets(project);
    return validateProject(project);
  }
  async save(project: ProjectSnapshot): Promise<SaveResult> {
    validateProject(project);
    const result: SaveResult = { saved: [], failures: [] };
    const bases = { ...project.cloud_bases };
    const groups = projectSaveGroups(project);
    const failedWorlds = new Set<string>();
    for (const { scopes, pending } of groups) {
      try {
        if (pending.some((r) => failedWorlds.has(r.world_id)))
          throw new Error(
            "Parent world metadata was not saved. Resolve that error first.",
          );
        const records = [
          ...new Map(
            [
              ...scopes.map((scope) => project.records[scope]).filter(Boolean),
              ...pending,
            ].map((r) => [r.key, r]),
          ).values(),
        ];
        const dependencies = new Map<string, ProjectRecord>();
        for (const r of records)
          if (r.kind === "scene")
            for (const key of sceneAssetKeys(r.scene)) {
              const asset = resolveAsset(project, key);
              if (!asset)
                throw new Error(
                  `Missing asset in ${r.name}. Relink or restore it before saving.`,
                );
              let item: ProjectRecord | undefined = asset;
              while (item) {
                dependencies.set(item.key, item);
                item = item.parent_key
                  ? project.records[item.parent_key]
                  : undefined;
              }
            }
        const reads = [
          ...new Map(
            [...records, ...dependencies.values()].map((r) => [r.key, r]),
          ).values(),
        ];
        // Refuse oversized commits instead of splitting related changes into a partly saved hierarchy.
        if (records.length > 400 || JSON.stringify(records).length > 6_000_000)
          throw new Error(
            "This volume has too many pending changes for one safe commit. Export a backup and save smaller groups.",
          );
        const saved = await runTransaction(this.db, async (tx) => {
          const allSnapshots = await Promise.all(
            reads.map((record) => tx.get(doc(this.db, record.key))),
          );
          const byKey = new Map(reads.map((r, i) => [r.key, allSnapshots[i]]));
          const snapshots = records.map((r) => byKey.get(r.key)!);
          const acknowledgements: SavedRecord[] = [];
          for (let index = 0; index < reads.length; index++) {
            const record = reads[index],
              snap = allSnapshots[index];
            const actual = snap.exists() ? fingerprint(snap.data()) : null;
            if (actual !== (bases[record.key] ?? null))
              throw new Error(
                `Conflict in ${record.name}. Cloud content changed or has not been loaded. Export your local backup, then load the latest cloud project.`,
              );
            if (
              dependencies.has(record.key) &&
              !records.some((r) => r.key === record.key) &&
              (!snap.exists() || snap.data()?.deleted_at)
            )
              throw new Error(
                `Referenced content ${record.name} is unavailable in Firebase.`,
              );
          }
          for (let index = 0; index < records.length; index++) {
            const record = records[index],
              snap = snapshots[index];
            const revision = Number(snap.data()?.revision ?? 0) + 1;
            const encoded = { ...encodeRecord(record), revision };
            const clearBackground =
              record.kind === "scene" && record.scene.background === undefined;
            const acknowledged: Record<string,unknown> = { ...snap.data(), ...encoded };
            if (clearBackground) delete acknowledged.background;
            // Merge retains existing fields not owned by this phase.
            tx.set(
              doc(this.db, record.key),
              {
                ...encoded,
                ...(clearBackground ? { background: deleteField() } : {}),
                updated_at: serverTimestamp(),
              },
              { merge: true },
            );
            acknowledgements.push({
              key: record.key,
              generation: record.generation,
              revision,
              base: fingerprint(acknowledged),
            });
          }
          return acknowledgements;
        });
        result.saved.push(...saved);
        for (const ack of saved) bases[ack.key] = ack.base;
      } catch (error) {
        for (const scope of scopes)
          result.failures.push({ scope, message: cloudError(error) });
        if (pending[0].kind === "world") failedWorlds.add(pending[0].world_id);
      }
    }
    return result;
  }
}
export function acknowledgeSaves(
  project: ProjectSnapshot,
  saved: SavedRecord[],
) {
  for (const ack of saved) {
    const current = project.records[ack.key];
    if (!current) continue;
    project.cloud_bases[ack.key] = ack.base;
    current.revision = ack.revision;
    if (current.generation === ack.generation)
      project.dirty = project.dirty.filter((key) => key !== ack.key);
  }
}
