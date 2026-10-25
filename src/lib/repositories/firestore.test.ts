import { describe, expect, it } from "vitest";
import {
  acknowledgeSaves,
  cloudError,
  decodeRecord,
  encodeRecord,
  fingerprint,
  sameAuthoredRecord,
} from "./firestore";
import { seedProject } from "../../features/project/migrations";
import { itemKey } from "../../features/project/model";
import { markChanged } from "../../features/project/commands";
describe("cloud compatibility and acknowledgements", () => {
  it("recognizes identical metadata without treating cloud revision differences as authored edits", () => {
    const { project } = seedProject(),
      record = project.records["studio_worlds/sea_wonders"];
    const raw = {
      ...encodeRecord(record),
      revision: 7,
      updated_at: "server timestamp",
      future_extension: { retained: true },
    };
    expect(sameAuthoredRecord(record, raw)).toBe(true);
    expect(
      sameAuthoredRecord(record, { ...raw, name: "Different world" }),
    ).toBe(false);
    expect(sameAuthoredRecord(record, { ...raw, unlock_level: 99 })).toBe(
      false,
    );
    expect(
      sameAuthoredRecord(record, {
        ...raw,
        deleted_at: new Date().toISOString(),
      }),
    ).toBe(false);
    expect(sameAuthoredRecord(record, { ...raw, id: "another-world" })).toBe(
      false,
    );
    expect(sameAuthoredRecord(record, { ...raw, schema_version: 99 })).toBe(
      false,
    );
  });
  it("does not equate different activation flags or scene content", () => {
    const { project } = seedProject(),
      volume = project.records["studio_worlds/sea_wonders/volumes/volume_01"],
      scene =
        project.records[itemKey("sea_wonders", "volume_01", "scene", "main")];
    expect(
      sameAuthoredRecord(volume, { ...encodeRecord(volume), is_active: true }),
    ).toBe(false);
    expect(
      sameAuthoredRecord(scene, { ...encodeRecord(scene), revision: 2 }),
    ).toBe(true);
    const different = structuredClone(encodeRecord(scene));
    (different.entities as { x: number }[])[0].x = 987;
    expect(sameAuthoredRecord(scene, different)).toBe(false);
  });
  it("reads legacy scene documents and exports scene fields at the original document root", () => {
    const { project } = seedProject(),
      key = itemKey("sea_wonders", "volume_01", "scene", "main");
    const source = project.records[key];
    if (source.kind !== "scene") throw new Error("fixture");
    const legacy = { ...source.scene, schema_version: 1, custom: "preserved" };
    const decoded = decodeRecord(
      legacy,
      key,
      "scene",
      "sea_wonders",
      "volume_01",
      "main",
    );
    const encoded = encodeRecord(decoded);
    expect(encoded.entities).toEqual(source.scene.entities);
    expect(encoded.custom).toBe("preserved");
    expect(encoded.scene).toBeUndefined();
    expect(encoded.key).toBeUndefined();
    expect(encoded.generation).toBeUndefined();
    expect(encoded.scene_id).toBe("main");
  });
  it("does not mark edits made during an in-flight save as acknowledged", () => {
    const { project } = seedProject(),
      record = Object.values(project.records)[0];
    const generation = record.generation;
    markChanged(project, record);
    acknowledgeSaves(project, [
      { key: record.key, generation, revision: 1, base: "saved" },
    ]);
    expect(project.dirty).toContain(record.key);
    expect(project.cloud_bases[record.key]).toBe("saved");
    acknowledgeSaves(project, [
      {
        key: record.key,
        generation: record.generation,
        revision: 2,
        base: "new",
      },
    ]);
    expect(project.dirty).not.toContain(record.key);
  });
  it("compares legacy content deterministically and explains denied/offline access", () => {
    expect(fingerprint({ a: 1, b: 2, updated_at: 1 })).toBe(
      fingerprint({ updated_at: 2, b: 2, a: 1 }),
    );
    expect(fingerprint({ a: 2 })).not.toBe(fingerprint({ a: 1 }));
    expect(cloudError({ code: "permission-denied" })).toContain("studioAdmin");
    expect(cloudError({ code: "unavailable" })).toContain("local drafts");
  });
});
