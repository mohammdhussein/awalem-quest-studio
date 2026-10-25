# Phase 1 implementation and handoff

## Delivered behavior

- Data-driven worlds and volumes retain the canonical five world IDs, original `volume_01`–`volume_03` IDs, unlock levels, and inactive volume flags. Additional worlds/volumes have stable generated IDs; there is no fixed catalog maximum.
- The project tree supports worlds, volumes, missions, scenes, nested folders, rename, search, scene duplication, context menus, expansion, keyboard navigation, within-volume drag/drop, and a move dialog. Left/right panels resize with mouse or arrow keys on the separators.
- Deletion confirms the branch size, blocks external scene/asset references, and uses reversible Trash metadata. Files and documents are not permanently deleted. Restoration checks parents and missing dependencies.
- Missions initially configure a name, description, and a starting-scene ID within their volume. Folder location is organization; mission references remain stable after moves or renames.
- Independent scene drafts keep the original PixiJS coordinate system, selection/dragging, inspector properties, interactions, layer ordering, and scene export. New scenes are empty; existing demo scenes are retained.
- IndexedDB stores the complete hierarchy, drafts, selection, expanded branches, cloud baselines, and dirty tracking in one atomic write. Scene navigation flushes pending drafts; save failures remain visible. Concurrent browser tabs cannot silently overwrite a newer local draft.
- Legacy localStorage values are read once when creating the new project, validated, migrated to version 2 scene `main`, and left untouched. Malformed legacy values also get an exportable recovery record. An existing IndexedDB project is loaded rather than reseeded. Invalid stored projects remain unchanged and editing falls back to explicitly labeled memory-only drafts with backup export.
- Explicit cloud save uses a conflict boundary per world/volume. Related document changes commit atomically. Failed scopes remain dirty, successful scopes are acknowledged, and edits made while a save is running remain pending. Legacy documents without revisions are compared against their last-read content too.
- Explicit cloud load validates the complete result before replacing drafts, creates a recovery copy, and keeps the latest scene selection. Local edits during the request cancel replacement. The Recovery dialog exports or restores prior snapshots, making another backup before restoration.
- Existing image references are cataloged by stable ID without changing URLs or Storage paths. PNG/JPEG/WebP uploads retain original bytes, track progress/dimensions/size, and can be reused across scenes. Asset cards search/sort, show metadata state, and report failed previews. Missing references produce a visible project warning.
- Firebase Authentication retains email/password sign-in and verifies the server-issued `studioAdmin: true` claim. Refresh access refreshes the token. The frontend cannot grant claims. Missing Storage configuration no longer prevents Auth/Firestore initialization.

## Data and compatibility

Canonical Firestore paths remain:

```text
studio_worlds/{worldId}
  volumes/{volumeId}
    missions/{missionId}
    folders/{folderId}
    scenes/{sceneId}    # legacy main stays here
    assets/{assetId}
```

Folder hierarchy is `parent_key` metadata, independent of document paths and physical directories. Moves do not relocate cloud documents or files. Each managed document has versioned metadata, a stable ID, name, ordering, revision, draft/published status, and optional Trash timestamp. World/volume documents keep their original content settings.

Scene version 2 adds `scene_id`; entities optionally add `assetId`. Scene fields remain at the scene document root for compatibility with the original `scenes/main` format. Version 1 inputs are migrated in memory. Remote unknown fields are retained by merge writes, and supported scene/entity extension fields survive authoring. Unsupported schemas, invalid scene identities, cycles, malformed entities, unsafe image URLs, and unsupported scene dimensions are rejected without overwriting their source.

Legacy cloud saves could omit ancestor documents. Loading queries both discovered world/volume records and the known seeded volume paths, so those scenes remain discoverable. Initial local content has no cloud baseline; attempting to save over an existing unseen cloud document produces a conflict rather than overwriting it. Export the local backup before an explicit cloud load when both copies matter.

Storage paths remain `studio-worlds/{worldId}/volumes/{volumeId}/sprites/{uuid}-{filename}`. Renaming an asset does not rename its stored file. Importing a file uploads the bytes, then records a **local metadata draft**; the UI directs the user to Save to Firebase for metadata. If its destination disappears during upload, a recovery receipt containing the uploaded reference is exported.

The existing Firestore and Storage rule files and `.env` were not changed. The new paths fit the checked-in volume-descendant administrator rules. No deployment, permanent cloud deletion, production seeding, Admin SDK, or service-account credential was introduced.

## Verification

Commands:

```text
npm test
npm run test:emulator
npm run build
npm audit --omit=dev
```

Verified on 2026-10-25: **21 unit/component tests passed**, **7 Firestore/Storage emulator tests passed**, and **the production build passed**. Emulator processes were cleaned up after the run. Expected access-denial diagnostics in the emulator output come from the negative permission tests.

The unit/component suite covers catalog extensibility, nested CRUD, stable IDs, invalid moves/cycles, independent duplication, reference-aware Trash and restoration, legacy migration, source retention, invalid schemas, atomic draft recovery, concurrent local tabs, cloud compatibility, in-flight save acknowledgements, clear errors, and delayed-load protection.

The React workflow test uses actual explorer/dialog/inspector controls with a viewport test adapter. It creates nested folders, a mission and scene, edits two independent scenes, switches between them, moves and renames a scene, verifies protected deletion, restores Trash, and reopens the IndexedDB snapshot to verify persistence. It does **not** verify WebGL rendering or native drag input.

The emulator suite uses real modular Firebase SDK calls against isolated local Firestore and Storage instances and the unchanged rules. It covers authorized hierarchy/scene round trips, ordinary/signed-out denial, denial outside studio paths, parentless legacy scenes, legacy and revision-based conflicts, independent partial success, unknown-field retention, cloud Trash/restore, allowed image upload/download, and rejected users/formats. Its runner owns and cleans up its emulator process tree, including Java children on Windows.

No browser was connected to the available browser tools. Live browser layout, PixiJS rendering/dragging, and touch input therefore remain manual checks. No authenticated production Firebase round trip was performed; emulator success does not establish deployed service/rule readiness.

The production build passes with Vite's existing large-bundle warning. The production dependency audit reports zero findings. Five moderate findings remain in development-only Firebase CLI dependencies; no force downgrade or framework replacement was applied. Vitest was updated and the compatible `@grpc/grpc-js` override removes the reported high/critical dependency findings.

## Changed files

| Area | Files |
| --- | --- |
| Existing integration | `src/App.tsx`, `src/data/scene.ts`, `src/lib/firebase.ts`, `src/lib/cloud.ts`, `src/style.css`, `src/vite-env.d.ts` |
| Project domain/state | `src/features/project/model.ts`, `validation.ts`, `commands.ts`, `migrations.ts`, `store.ts` |
| Project UI/recovery | `src/features/project/ProjectExplorer.tsx`, `Dialog.tsx`, `ItemInspector.tsx`, `Recovery.tsx`, `export.ts` |
| Asset catalog | `src/features/assets/catalog.ts`, `AssetBrowser.tsx` |
| Persistence/auth | `src/lib/repositories/local.ts`, `firestore.ts`, `src/lib/studioAuth.ts` |
| Preserved editor controls extracted into components | `src/components/EntityInspector.tsx`, `FirebasePanel.tsx`, `PanelDivider.tsx` |
| Unit/component tests | `src/App.test.tsx`, `src/features/project/project.test.ts`, `src/lib/repositories/local.test.ts`, `firestore.test.ts` |
| Emulator tests/tooling | `tests/project.emulator.test.ts`, `scripts/test-emulator.mjs`, `firebase.emulators.json`, `vitest.config.ts`, `vitest.emulator.config.ts` |
| Dependencies/documentation | `package.json`, `package-lock.json`, `.gitignore`, `README.md`, `PHASE_1.md` |

The existing `SceneViewport.tsx`, bundled catalog/content, Firebase security rules, production project selection, and configuration values are retained. No new starter project was created.

## Limits and next development step

- Phase 1 is a single-editor workflow with explicit conflict detection, not automatic collaboration or merging. Saving more than 400 pending records or approximately 6 MB in one volume is refused to preserve atomicity; large-volume incremental commits need a follow-up design. No permanent content-count limit is imposed locally.
- Recovery snapshots and exports contain authoring JSON and file references, not downloaded image binaries. Storage is required for new image importing in this phase; there is no local-binary import, SVG/audio/sprite-sheet pipeline, or archive importer yet. Legacy image sizes/dimensions stay unknown unless the source metadata provides them.
- Publishing is not implemented. New content defaults to draft; existing status values are retained. The authoring catalog remains separate from player accounts, economy, backups, and published mobile assets.
- The viewport still uses 960 × 540 coordinates and the existing demo background. Real assets keep their original proportions/transparency. No replacement art was generated. Comprehensive Arabic UI translation, RTL layout QA, and responsive playable previews remain future work; organization names support Unicode and new UI styles use logical spacing where practical.
- Next: complete Phase 2 with transform handles, multi-selection, grid/camera controls, object locking/visibility, layers, and undo/redo on the typed scene store, then expand the asset pipeline in Phase 3.

For a manual browser acceptance check, run the dev server and repeat the component workflow above, refresh after the saved-local indicator appears, verify PixiJS object dragging/inspector updates, then sign in to an authorized test environment for a deliberate cloud save/load and sprite upload.
