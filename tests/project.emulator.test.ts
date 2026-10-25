import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDocFromServer,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import {
  getDownloadURL,
  getBytes,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";
import {
  FirestoreProjectRepository,
  acknowledgeSaves,
} from "../src/lib/repositories/firestore";
import { seedProject } from "../src/features/project/migrations";
import {
  createItem,
  markChanged,
  renameItem,
  trashItem,
  restoreItem,
  addAsset,
  moveItem,
} from "../src/features/project/commands";
import { isTrashed, itemKey, volumeKey } from "../src/features/project/model";
import { newLayer } from "../src/features/backgrounds/model";

let environment: RulesTestEnvironment;
const vk = volumeKey("sea_wonders", "volume_01"),
  main = itemKey("sea_wonders", "volume_01", "scene", "main");
beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_STORAGE_EMULATOR_HOST
  )
    throw new Error(
      "Use npm run test:emulator. Tests never connect to production.",
    );
  environment = await initializeTestEnvironment({
    projectId: "demo-awalem-studio",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
});
afterAll(async () => {
  await environment?.cleanup();
});
const adminDB = () =>
  environment
    .authenticatedContext(`admin-${crypto.randomUUID()}`, { studioAdmin: true })
    .firestore() as unknown as Firestore;
describe("Firestore project persistence against unchanged rules", () => {
  it("acknowledges identical existing starter records without a baseline and safely saves new local scenes", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db),
      initial = seedProject().project;
    expect((await repo.save(initial)).failures).toEqual([]);
    const oldWorld = (
        await getDocFromServer(doc(db, "studio_worlds/sea_wonders"))
      ).data()!,
      oldScene = (await getDocFromServer(doc(db, main))).data()!;
    const fresh = seedProject().project,
      newScene = createItem(fresh, "scene", "New local draft", vk);
    const result = await repo.save(fresh);
    expect(result.failures).toEqual([]);
    acknowledgeSaves(fresh, result.saved);
    expect(fresh.dirty).toEqual([]);
    expect((await getDocFromServer(doc(db, newScene.key))).exists()).toBe(true);
    expect(
      (await getDocFromServer(doc(db, "studio_worlds/sea_wonders"))).data(),
    ).toEqual(oldWorld);
    expect((await getDocFromServer(doc(db, main))).data()).toEqual(oldScene);
    expect((await getDocFromServer(doc(db, vk))).data()?.revision).toBe(2);
    expect((await repo.save(fresh)).saved).toEqual([]);
  });
  it("keeps different local drafts and cloud content protected when no baseline exists", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db);
    expect((await repo.save(seedProject().project)).failures).toEqual([]);
    await setDoc(
      doc(db, main),
      { name: "Cloud-authored scene" },
      { merge: true },
    );
    const cloud = (await getDocFromServer(doc(db, main))).data()!;
    const fresh = seedProject().project,
      local = fresh.records[main];
    if (local.kind !== "scene") throw new Error("fixture");
    local.scene.entities[0].x = 876;
    markChanged(fresh, local);
    const result = await repo.save(fresh);
    acknowledgeSaves(fresh, result.saved);
    expect(result.failures.map((f) => f.scope)).toEqual([vk]);
    expect(result.failures[0].message).toContain("Conflict");
    expect(fresh.dirty).toContain(main);
    expect(local.scene.entities[0].x).toBe(876);
    expect((await getDocFromServer(doc(db, main))).data()).toEqual(cloud);
    expect(fresh.cloud_bases["studio_worlds/sea_wonders"]).not.toBeNull();
  });
  it("continues rejecting a known stale baseline even when the new cloud content matches the local desired state", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db);
    await repo.save(seedProject().project);
    const stale = await repo.load();
    await setDoc(doc(db, main), { name: "Same desired name" }, { merge: true });
    renameItem(stale, main, "Same desired name");
    const result = await repo.save(stale);
    expect(result.failures[0].message).toContain("Conflict");
    expect(stale.dirty).toContain(main);
  });
  it("recovers an untouched revision-one starter as the baseline for local objects, assets, background, and mission organization", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db);
    expect((await repo.save(seedProject().project)).failures).toEqual([]);
    const fresh = seedProject().project,
      mission = createItem(fresh, "mission", "Mission 1", vk),
      asset = addAsset(fresh, vk, {
        name: "Local reef",
        url: "https://example.test/local-reef.png",
        storage_path: null,
        width: 1600,
        height: 900,
        size: 500,
        mime: "image/png",
      }),
      scene = fresh.records[main];
    if (mission.kind !== "mission" || scene.kind !== "scene")
      throw new Error("fixture");
    mission.starting_scene_id = "main";
    moveItem(fresh, main, mission.key);
    scene.scene.entities.push({
      ...scene.scene.entities[0],
      id: "local-image",
      name: "Local image",
      shape: "image",
      assetKey: asset.key,
      assetId: asset.id,
      assetUrl: asset.url,
      x: 650,
    });
    scene.scene.background = {
      version: 1,
      showWorldArtwork: false,
      layers: [newLayer(asset.key, "Local background", "background")],
    };
    markChanged(fresh, scene);
    const expected = structuredClone(scene.scene),
      result = await repo.save(fresh);
    expect(result.failures).toEqual([]);
    expect(result.recovered).toEqual([main]);
    acknowledgeSaves(fresh, result.saved);
    expect(fresh.dirty).toEqual([]);
    const loaded = (await repo.load()).records[main];
    if (loaded.kind !== "scene") throw new Error("fixture");
    expect(loaded.scene).toEqual(expected);
    expect(loaded.parent_key).toBe(mission.key);
    expect((await getDocFromServer(doc(db, asset.key))).exists()).toBe(true);
    expect(
      (await getDocFromServer(doc(db, "studio_worlds/sea_wonders"))).data()
        ?.revision,
    ).toBe(1);
  });
  it("does not recover missing baselines for later cloud revisions even when they resemble starter content", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db);
    await repo.save(seedProject().project);
    await setDoc(doc(db, main), { revision: 2 }, { merge: true });
    const fresh = seedProject().project,
      scene = fresh.records[main];
    if (scene.kind !== "scene") throw new Error("fixture");
    scene.scene.entities[0].x = 555;
    markChanged(fresh, scene);
    const result = await repo.save(fresh);
    expect(result.failures[0].message).toContain("Conflict");
    expect(result.recovered).toEqual([]);
    expect(
      (await getDocFromServer(doc(db, main))).data()?.entities[0].x,
    ).not.toBe(555);
  });
  it("saves and loads nested folders, mission configuration, and independent scenes", async () => {
    const repo = new FirestoreProjectRepository(adminDB()),
      { project } = seedProject();
    const mission = createItem(project, "mission", "Mission 1", vk),
      folder = createItem(project, "folder", "Animals", mission.key);
    const scene = createItem(project, "scene", "Reef", folder.key);
    if (mission.kind !== "mission") throw new Error("fixture");
    mission.description = "Rescue a dolphin";
    mission.starting_scene_id = scene.id;
    const saved = await repo.save(project);
    expect(saved.failures).toEqual([]);
    acknowledgeSaves(project, saved.saved);
    expect(project.dirty).toEqual([]);
    const loaded = await repo.load();
    expect(loaded.records[folder.key].parent_key).toBe(mission.key);
    expect(loaded.records[scene.key].parent_key).toBe(folder.key);
    expect(loaded.records[mission.key]).toMatchObject({
      description: "Rescue a dolphin",
      starting_scene_id: scene.id,
    });
    expect(loaded.records[main].kind).toBe("scene");
    expect(loaded.dirty).toEqual([]);
  });
  it("denies ordinary users, signed-out clients, and writes outside studio paths", async () => {
    const staff = environment
      .authenticatedContext("staff")
      .firestore() as unknown as Firestore;
    const guest = environment
      .unauthenticatedContext()
      .firestore() as unknown as Firestore;
    await assertFails(getDocFromServer(doc(staff, main)));
    await assertFails(setDoc(doc(staff, main), {}));
    await assertFails(getDocFromServer(doc(guest, main)));
    await assertFails(setDoc(doc(adminDB(), "player_accounts/test"), {}));
    const denied = await new FirestoreProjectRepository(staff).save(
      seedProject().project,
    );
    expect(denied.saved).toEqual([]);
    expect(denied.failures.some((f) => f.message.includes("studioAdmin"))).toBe(
      true,
    );
  });
  it("discovers legacy scenes with missing ancestor documents and detects unversioned conflicts", async () => {
    const db = adminDB(),
      { project } = seedProject(),
      record = project.records[main];
    if (record.kind !== "scene") throw new Error("fixture");
    await setDoc(doc(db, main), {
      ...record.scene,
      schema_version: 1,
      entities: [{ ...record.scene.entities[0], x: 123 }],
    });
    const repo = new FirestoreProjectRepository(db),
      loaded = await repo.load();
    expect(loaded.records[main]).toMatchObject({
      scene: { entities: [{ x: 123 }] },
    });
    renameItem(loaded, main, "Local name");
    await setDoc(doc(db, main), {
      ...record.scene,
      schema_version: 1,
      entities: [{ ...record.scene.entities[0], x: 456 }],
    });
    const result = await repo.save(loaded);
    expect(result.failures.some((f) => f.message.includes("Conflict"))).toBe(
      true,
    );
    expect((await getDocFromServer(doc(db, main))).data()?.entities[0].x).toBe(
      456,
    );
    expect(loaded.dirty).toContain(main);
  });
  it("rejects stale volume saves while acknowledging independent successful scopes", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db),
      initial = seedProject().project;
    const saved = await repo.save(initial);
    expect(saved.failures).toEqual([]);
    const a = await repo.load(),
      b = await repo.load();
    renameItem(a, main, "Remote rename");
    expect((await repo.save(a)).failures).toEqual([]);
    renameItem(b, main, "Stale rename");
    const other = itemKey("sea_wonders", "volume_02", "scene", "main");
    renameItem(b, other, "Independent rename");
    const result = await repo.save(b);
    acknowledgeSaves(b, result.saved);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].scope).toBe(vk);
    expect(b.dirty).toContain(main);
    expect(b.dirty).not.toContain(other);
    expect((await getDocFromServer(doc(db, main))).data()?.name).toBe(
      "Remote rename",
    );
    expect((await getDocFromServer(doc(db, other))).data()?.name).toBe(
      "Independent rename",
    );
  });
  it("retains unrelated existing cloud fields on managed metadata updates", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db);
    const result = await repo.save(seedProject().project);
    expect(result.failures).toEqual([]);
    await setDoc(
      doc(db, vk),
      { future_extension: { keep: true } },
      { merge: true },
    );
    const loaded = await repo.load();
    const volume = loaded.records[vk];
    volume.name = "Renamed";
    markChanged(loaded, volume);
    expect((await repo.save(loaded)).failures).toEqual([]);
    expect(
      (await getDocFromServer(doc(db, vk))).data()?.future_extension,
    ).toEqual({ keep: true });
  });
  it("persists and restores deleted branches without deleting their underlying documents", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db),
      project = seedProject().project;
    const folder = createItem(project, "folder", "Recovery reef", vk),
      scene = createItem(project, "scene", "Retained scene", folder.key);
    const first = await repo.save(project);
    expect(first.failures).toEqual([]);
    acknowledgeSaves(project, first.saved);
    trashItem(project, folder.key);
    expect((await repo.save(project)).failures).toEqual([]);
    const trashed = await repo.load();
    expect(isTrashed(trashed, scene.key)).toBe(true);
    expect((await getDocFromServer(doc(db, scene.key))).exists()).toBe(true);
    restoreItem(trashed, folder.key);
    expect((await repo.save(trashed)).failures).toEqual([]);
    expect(isTrashed(await repo.load(), scene.key)).toBe(false);
  });
  it("round-trips Phase 2 transforms without serializing editor session state and rejects stale saves", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db),
      project = seedProject().project;
    const record = project.records[main];
    if (record.kind !== "scene") throw new Error("fixture");
    Object.assign(record.scene.entities[0], {
      scale: 1.75,
      scaleX: 1.75,
      scaleY: 0.6,
      rotation: 37,
      x: -100,
      y: 750,
      opacity: 0.42,
      visible: false,
      locked: true,
      selectable: false,
      anchor: { x: 0.25, y: 0.75 },
      pivot: { x: 12, y: -7 },
    });
    expect((await repo.save(project)).failures).toEqual([]);
    const a = await repo.load(),
      b = await repo.load();
    const loaded = a.records[main];
    if (loaded.kind !== "scene") throw new Error("fixture");
    expect(loaded.scene.entities[0]).toMatchObject(record.scene.entities[0]);
    const raw = (await getDocFromServer(doc(db, main))).data()!;
    expect(raw.entities[0].pivot).toEqual({ x: 12, y: -7 });
    for (const field of [
      "history",
      "undo",
      "redo",
      "camera",
      "selectedIds",
      "gesture",
    ])
      expect(raw[field]).toBeUndefined();
    loaded.scene.entities[0].x = 123;
    markChanged(a, loaded);
    expect((await repo.save(a)).failures).toEqual([]);
    const stale = b.records[main];
    if (stale.kind !== "scene") throw new Error("fixture");
    stale.scene.entities[0].x = 999;
    markChanged(b, stale);
    expect((await repo.save(b)).failures[0]?.message).toContain("Conflict");
    expect((await getDocFromServer(doc(db, main))).data()?.entities[0].x).toBe(
      123,
    );
  });
});
describe("Phase 3 shared backgrounds", () => {
  it("removes a previously saved background when undo restores the original implicit world artwork", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db),
      p = seedProject().project;
    const source = addAsset(p, vk, {
      name: "Reef",
      url: "https://example.test/reef.png",
      storage_path: null,
      width: 500,
      height: 500,
      size: 100,
      mime: "image/png",
    });
    const scene = p.records[main];
    if (scene.kind !== "scene") throw new Error("fixture");
    scene.scene.background = {
      version: 1,
      showWorldArtwork: false,
      layers: [newLayer(source.key, "Reef", "background")],
    };
    let result = await repo.save(p);
    expect(result.failures).toEqual([]);
    acknowledgeSaves(p, result.saved);
    delete scene.scene.background;
    markChanged(p, scene);
    result = await repo.save(p);
    expect(result.failures).toEqual([]);
    acknowledgeSaves(p, result.saved);
    expect(
      (await getDocFromServer(doc(db, main))).data()?.background,
    ).toBeUndefined();
    const loaded = (await repo.load()).records[main];
    if (loaded.kind !== "scene") throw new Error("fixture");
    expect(loaded.scene.background).toBeUndefined();
    scene.scene.background = {
      version: 1,
      showWorldArtwork: false,
      layers: [newLayer(source.key, "Restored", "background")],
    };
    markChanged(p, scene);
    expect((await repo.save(p)).failures).toEqual([]);
  });
  it("round-trips shared backgrounds across worlds and rejects stale layer edits without changing objects", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db),
      project = seedProject().project;
    const source = addAsset(project, vk, {
      name: "Underwater",
      url: "https://example.test/underwater.png",
      storage_path:
        "studio-worlds/sea_wonders/volumes/volume_01/sprites/test.png",
      width: 1600,
      height: 900,
      size: 500,
      mime: "image/png",
    });
    const target = itemKey("jungle_kingdom", "volume_01", "scene", "main"),
      scene = project.records[target];
    if (scene.kind !== "scene") throw new Error("fixture");
    const entities = structuredClone(scene.scene.entities),
      layer = {
        ...newLayer(source.key, "Far reef", "background"),
        mode: "tile" as const,
        parallaxX: 0.2,
        scrollX: -15,
        tint: "#85dfff",
        opacity: 0.7,
      };
    scene.scene.background = {
      version: 1,
      showWorldArtwork: false,
      layers: [
        layer,
        { ...newLayer(source.key, "Near reef", "foreground"), parallaxX: 1.3 },
      ],
    };
    const saved = await repo.save(project);
    expect(saved.failures).toEqual([]);
    acknowledgeSaves(project, saved.saved);
    expect(project.dirty).toEqual([]);
    const first = await repo.load(),
      stale = await repo.load(),
      loaded = first.records[target];
    if (loaded.kind !== "scene") throw new Error("fixture");
    expect(loaded.scene.background).toEqual(scene.scene.background);
    expect(loaded.scene.entities).toEqual(entities);
    loaded.scene.background!.layers[0].scrollX = 25;
    markChanged(first, loaded);
    expect((await repo.save(first)).failures).toEqual([]);
    const old = stale.records[target];
    if (old.kind !== "scene") throw new Error("fixture");
    old.scene.background!.layers[0].opacity = 0.1;
    markChanged(stale, old);
    expect((await repo.save(stale)).failures[0].message).toContain("Conflict");
    expect(
      (await getDocFromServer(doc(db, target))).data()?.background.layers[0]
        .scrollX,
    ).toBe(25);
    const raw = (await getDocFromServer(doc(db, target))).data()!;
    expect(raw.preview).toBeUndefined();
    expect(raw.elapsed).toBeUndefined();
    expect(raw.entities).toEqual(entities);
    expect(() => trashItem(first, source.key)).toThrow("uses");
  });
  it("keeps connected volumes atomic on a conflict while saving an unrelated volume", async () => {
    const db = adminDB(),
      repo = new FirestoreProjectRepository(db);
    expect((await repo.save(seedProject().project)).failures).toEqual([]);
    const p = await repo.load(),
      source = addAsset(p, vk, {
        name: "Shared new image",
        url: "https://example.test/new.png",
        storage_path: null,
        width: 500,
        height: 500,
        size: 100,
        mime: "image/png",
      });
    const target = itemKey("jungle_kingdom", "volume_01", "scene", "main"),
      scene = p.records[target];
    if (scene.kind !== "scene") throw new Error("fixture");
    scene.scene.background = {
      version: 1,
      showWorldArtwork: false,
      layers: [newLayer(source.key, "Shared layer", "background")],
    };
    markChanged(p, scene);
    await setDoc(
      doc(db, target),
      { name: "Concurrent remote edit" },
      { merge: true },
    );
    const unrelated = itemKey("polar_explorers", "volume_01", "scene", "main");
    renameItem(p, unrelated, "Independent change");
    const result = await repo.save(p);
    expect(result.failures.map((f) => f.scope)).toEqual(
      expect.arrayContaining([vk, volumeKey("jungle_kingdom", "volume_01")]),
    );
    expect((await getDocFromServer(doc(db, source.key))).exists()).toBe(false);
    expect(
      (await getDocFromServer(doc(db, target))).data()?.background,
    ).toBeUndefined();
    acknowledgeSaves(p, result.saved);
    expect(p.dirty).toContain(source.key);
    expect(p.dirty).toContain(target);
    expect(p.dirty).not.toContain(unrelated);
  });
});
describe("Storage compatibility against unchanged rules", () => {
  it("allows administrator image uploads and downloads but rejects other users and formats", async () => {
    const storage = environment
      .authenticatedContext("asset-admin", { studioAdmin: true })
      .storage() as unknown as FirebaseStorage;
    const reference = ref(
      storage,
      "studio-worlds/sea_wonders/volumes/volume_01/sprites/stable-test.png",
    );
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await assertSucceeds(
      uploadBytes(reference, bytes, { contentType: "image/png" }),
    );
    expect(await getDownloadURL(reference)).toContain("stable-test.png");
    expect(new Uint8Array(await getBytes(reference))).toEqual(bytes);
    const staff = environment
      .authenticatedContext("asset-staff")
      .storage() as unknown as FirebaseStorage;
    await assertFails(
      uploadBytes(
        ref(
          staff,
          "studio-worlds/sea_wonders/volumes/volume_01/sprites/denied.png",
        ),
        bytes,
        { contentType: "image/png" },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(
          storage,
          "studio-worlds/sea_wonders/volumes/volume_01/sprites/unsafe.svg",
        ),
        bytes,
        { contentType: "image/svg+xml" },
      ),
    );
  });
});
