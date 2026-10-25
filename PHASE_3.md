# Phase 3 — Visual background management

## Implementation

Branch: `feature/phase-3-background-management`, based on Phase 2 commit `c38fa0e`. Phase 2 PR #1 remains separate and unmerged; `main` is not modified. The user selected scene-specific backgrounds, original shared assets, camera-linked and automatic scrolling previews, and a combined live rollout including Phase 2 and the Storage CORS fix.

The Backgrounds panel has independent scrolling, thumbnails, background/foreground groups, selection, creation, image replacement, duplication, deletion, visibility, locking, and keyboard-accessible ordering actions. The Inspector exposes name, placement, layout mode, offsets, scale X/Y, opacity, tint, depth, camera factors, and scrolling speeds. Locked layers permit inspection, visibility changes, and unlocking.

**Set background** opens a searchable Asset Browser with current-volume/all-worlds filters and **Upload background** for administrators. Asset cards also offer **Set as background**. This replaces the lowest background image layer, or creates one, and hides built-in world artwork. Replacing an individual image preserves its other layer settings. All objects, characters, IDs, interactions, and gameplay fields remain intact. **Show built-in world artwork** is an explicit, undoable option; deleting all image layers does not silently restore it.

Each scene owns its background. A mission's **Edit scene background** action opens its configured starting scene; there is no inheritance. The existing Mission 1 setup remains idempotent and preserves the existing Main Scene.

| Mode | Behavior before authored offsets and axis scales |
| --- | --- |
| Fit | Center the full image, preserving aspect ratio |
| Fill | Center and crop to cover the scene |
| Stretch | Match the two scene dimensions independently |
| Tile | Repeat native image pixels |
| Custom | Native image dimensions with explicit positioning |

Custom mode reuses Phase 2 Move/Scale handles, snapping, aspect locking, capture, and cancellation. Background rotation is unavailable. F2 focuses the layer name; Delete/Ctrl+D operate on the selected layer. Text fields retain native editing.

**Play parallax**, Pause, and Stop/Reset preview camera-linked and timed scrolling. Camera factor 1 follows the scene, 0 is fixed relative to the preview viewport, and speeds use scene pixels/second. Negative speeds reverse direction. Space+drag and wheel navigation remain available; content editing is disabled until Stop, which restores the previous camera. Non-tiled images may intentionally scroll beyond the frame.

## Architecture and compatibility

- `SceneDocument.background` is optional: `{version: 1, showWorldArtwork, layers}`. Existing scene schema version 2 is extended additively. Legacy v1/v2 scenes retain their appearance and are not rewritten merely by viewing the panel. New fields are validated on reads and commits; unknown extensions and corrupt source recovery are preserved.
- Layers have stable IDs, canonical asset keys and independent presentation/motion settings. Scene/layer duplication generates new layer IDs and retains asset references. Assets remain in their original volume documents and Storage paths; reuse does not copy files. New scene instances also retain legacy IDs, URLs and paths.
- Asset resolution, counts, Trash protection, backups, and missing-reference warnings cover layers and cross-volume instances. Missing/trashed canonical assets remain configured for relinking and are not silently recreated.
- Reversible background deltas extend the existing scene command history. Typed entity/layer selection, Inspector transactions, one-command drags, cancellation, scene isolation, redo invalidation, and memory limits retain Phase 2 behavior. Delayed background uploads target their captured scene.
- Preview timing, camera snapshots, derived motion, selection, gestures, and gizmos remain session-only. Previewing does not dirty drafts, create commands, or alter exported scene data.
- Persistent Pixi nodes and shared reference-counted textures render background images below existing entity containers and foreground images above them. Entity Y + depth ordering stays unchanged. Image layers clip to the scene frame, use separate depth/order within each group, and are selected through their panel so large images do not intercept object picking. Tile mode uses `TilingSprite`.
- Existing IndexedDB, recovery, explicit Firebase save/load, generation acknowledgements, and revision checks remain. Dirty volumes connected by shared references save atomically; unrelated volumes stay independent. Transactions check referenced assets and ancestors. Existing 400-record / approximately 6 MB guards apply per connected group.
- Undoing the first background assignment restores the absence of its field. Firebase saves explicitly delete that owned field when needed while retaining unrelated extensions.

## Image-display fix and operations

Production diagnosis reproduced the reported failure: both uploaded PNG files existed and loaded into normal thumbnails, but Pixi requests failed because the bucket returned no `Access-Control-Allow-Origin` header. The cause was Storage CORS.

`storage.cors.json` permits GET/HEAD from the two existing Hosting origins (`https://awalem-quest-studio.web.app` and `https://awalem-quest-studio.firebaseapp.com`) with a 3600-second cache lifetime. The administrative script changes only CORS, preserves other bucket configuration/entries, uses a metageneration precondition, writes an ignored rollback receipt, and verifies the result. Security rules and file permissions are not changed.

```powershell
node scripts/storage-cors.mjs --check
node scripts/storage-cors.mjs --apply
node scripts/storage-cors.mjs --restore .firebase/cors-backup-TIMESTAMP.json
```

Check exits 2 if configuration is absent; Apply is idempotent. Restore refuses to overwrite a subsequently changed policy. This administrative script uses the locked Firebase CLI package's internal authentication/client modules; review it when upgrading that tooling. Credentials remain outside the client/build. See [Firebase CORS guidance](https://firebase.google.com/docs/storage/web/download-files#cors_configuration).

Image failures show a source-access/CORS/connectivity hint and **Retry images**. The editor does not classify every network failure as CORS.

## Actual verification — 2026-10-25

| Check | Result and limits |
| --- | --- |
| Unit/component | **79 passed in 11 files**, retaining previous regressions and adding layout, validation, commands/locks, shared references, history/cancellation, scene isolation, and session-only preview checks. Four React workflow tests mock the uploader and viewport. |
| Firestore/Storage emulators | **11 passed** against unchanged rules using only `demo-awalem-studio`: includes cross-world backgrounds, background field removal/restoration, stale saves, connected-volume atomic failure, and independent partial success. Expected denial warnings are negative permission tests. |
| Real Chrome | **18 passed**, nine scenarios at DPR 1 and 2: original editing/500-object tests, CORS failure/retry, actual Pixi screenshot-pixel assertions, Mission 1/layers/parallax/custom handles/undo/refresh, and cross-volume reuse. Storage is isolated and development Firebase is disabled. |
| Production build | TypeScript, Vite, administrator configuration, and Hosting output/credential checks passed. Existing large-chunk warning remains. |
| Production dependency audit | `npm audit --omit=dev`: **0 vulnerabilities**. |
| Visual review | Generated browser screenshot inspected for actual background rendering, preserved objects, panel layout/scrolling, and thumbnails. This is not a manual interactive browser session. |

The initial extended browser test was corrected to accept Mission 1's existing setup confirmation. A component assertion now waits for local persistence before checking the completed upload message. Review caught the Firestore field-removal edge case; its fix has an emulator regression test.

Production save/load through an authorized studio-admin browser session remains separate from emulator coverage and has not been performed. Live read-only image verification and deployment results are recorded below.

## Changed files

- New `src/features/backgrounds/`: models, layout math, commands, Pixi renderer, panel, Inspector, and unit/component tests.
- Existing integration: App, viewport, scene model, editor commands/session/fields/shortcuts/controller/toolbar/hierarchy, and CSS.
- Assets/project/persistence: Asset Browser/catalog, mission Inspector, project commands/store/validation, Firestore repository.
- Verification/operations/docs: browser background tests, emulator tests, CORS policy/admin script, README, and this report.

Firebase initialization, administrator access component, security rules, Hosting configuration/build guards, bundled game content/artwork, and framework dependencies are unchanged.

## Rollout and rollback

The authorized rollout applies CORS and deploys Hosting together after verification. Phase 2 is included because the live site was on the earlier release. No security rules deployment or production content migration is included.

Previous Hosting version: `919fbb5e56c01b48`; previous release: `1792939259853000`. Before rollout, bucket CORS was empty with metageneration 1. CORS receipts remain in ignored `.firebase/` storage.

Hosting rollback: Firebase Console → Hosting → release history → previous release → Roll back. Restore CORS separately with its captured receipt only if needed; the CORS fix also supports the previous editor.

Release completed on 2026-10-25, approximately 20:24 Asia/Jerusalem. Deployed source commit: `cc98727`. Hosting version: `c67ea512e913e814`; release: `1792952652559000`. The Hosting predeploy hook rebuilt the production application and passed its output/credential checks.

The CORS policy was applied and read back successfully at metageneration 2. Rollback receipt: `.firebase/cors-backup-1792952622983.json`. Previous/current Hosting receipts and live verification output are also retained in ignored `.firebase/` files.

Actual production checks:

- The live page references the new `index-B8MMSUSM.js` bundle containing Backgrounds, Upload background, and parallax controls.
- Root and `/studio/worlds/sea_wonders` return HTTP 200 and show the production sign-in gate in an isolated signed-out Chrome session. No editor canvas is accessible while signed out, and no unhandled page errors occurred.
- Three existing uploaded PNGs, including both images from the original screenshot, were downloaded read-only from the live Hosting origin. Normal thumbnails, browser fetch (HTTP 200), and real Pixi texture loading all succeeded with matching native dimensions. No files were reuploaded or replaced.
- No production Firestore content save/load, staff sign-in, new custom claim, security rules deployment, permanent deletion, or content migration was performed. An authorized studio-admin browser session was not available for the final interactive save/refresh checklist.

## Limitations and manual acceptance

Only single-object/layer editing is supported. Background rotation, more file formats, binary archives, gameplay/runtime scrolling, multiselection, and animation timelines remain later work. Imports remain PNG/JPEG/WebP below 10 MiB. Assets remain shared in their source volumes; oversized connected saves are rejected with drafts retained. Safari/Firefox, touch, mobile layout, and an interactive production-admin session are not established by headless Chrome tests.

1. Refresh the hosted editor and sign in as an existing administrator. Export a project backup.
2. Open Sea Wonders → Volume 1 → Mission 1 → starting scene; Set background → Upload background and choose the intended underwater artwork.
3. Verify existing objects, then add and configure background/foreground layers. Exercise modes, tint/opacity, locks/visibility, ordering, replacement, undo/redo, and Custom handles.
4. Preview camera/timed parallax and Stop. Preview alone must not create pending authored changes.
5. Save to Firebase, wait for acknowledgement, refresh, and verify backgrounds and all object data. A stale second client should receive a conflict.
6. Reuse the same asset from another world/volume; its layer transforms must stay independent.

Next work: import/recovery formats and texture sizing/performance, followed by declarative gameplay behaviors, on separate branches.
