# Phase 2 — Professional 2.5D scene editing

## Branch and baseline

Implementation branch: `feature/phase-2-scene-editing`.

The pre-existing Hosting/access changes passed 35 tests and the production build/output verification and were preserved in their own prerequisite commit, `ee201d0`. Phase 2 starts from that commit. The production administrator gate, Firebase configuration, service initialization, security rules, and Hosting build/output checks are preserved. `main` remains at `aea33c1`; no deployment or production data operation is part of this phase.

## Implemented features

- Single-object canvas picking uses actual Pixi sprite/graphics hit testing and transformed bounds. The Scene Hierarchy, viewport outline, and Inspector share stable object-ID selection. Empty-canvas clicks deselect without changing authored content.
- The Scene Hierarchy is separate from the Project Explorer and has independent scrolling, layer groups, F2/dialog rename, duplicate/delete, visibility and lock controls, and Front/Back ordering actions. Project folder/mission shortcuts remain independent.
- W selects Move with free, X-axis, and Y-axis handles. E selects Rotate with a rotation handle. R selects Scale with eight corner/edge handles. Handles remain a constant screen size. Canvas coordinates are shown during editing.
- Move supports configurable scene-space grid snapping. Rotation optionally snaps to the configured angle. Scaling supports aspect locking and independent axes, preserves the opposite resize edge/corner, and prevents zero/negative scales through the handles.
- Inspector controls include name, X/Y, rotation, scale X/Y, rendered width/height, opacity, visibility, locking, viewport selectability, layer/depth, image anchor, pivot, sample color, and existing interaction definitions. Image source colors are retained. Geometry-dependent image controls wait for the real texture instead of using a loading/error placeholder.
- Locked objects cannot be picked from the canvas or otherwise edited, duplicated, deleted, or reordered. They remain inspectable through the hierarchy, with visibility changes and unlocking available. Hidden/non-selectable objects are excluded from canvas picking; hierarchy access is retained. Hidden objects have no gizmos.
- Wheel zoom preserves the scene point under the cursor. Space+drag and middle-button drag pan. Fit and 100% reset controls, grid visibility, grid size, snap settings, aspect lock, and angle settings are available. Objects may be positioned outside the scene frame.
- Background, playfield, and foreground use separate containers. Y + depth sorting remains within each layer, preserving existing 2.5D behavior without allowing large/off-canvas Y values to cross layer boundaries. Front/Back changes depth offsets and is reversible.
- The explicit **Set up / open Mission 1** action creates or reuses the local Sea Wonders / Volume 1 mission, links and organizes the existing Main Scene, retains IDs/content, and does not save to Firebase automatically. Repeating it reuses the configured mission. Ambiguous, differently configured, or trashed content requires review instead of silent replacement.
- Undo/redo covers object creation, placement, duplication, deletion, transforms, renaming, and property changes. One completed drag or Inspector focus session is one command. Escape/pointer cancellation restores the starting state. Selection and navigation never become scene-content commands.
- Toolbar Undo/Redo and Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z work in editor context, including after completing an Inspector field. Text inputs retain native editing, while the project tree retains its own shortcuts. Ctrl+D duplicates the selected object; Delete removes it; F2 opens object rename.

## Architecture and persistence decisions

### Scene data compatibility

Scene version 2 is extended additively with optional `scaleX`, `scaleY`, `opacity`, `visible`, `locked`, `selectable`, `anchor`, and `pivot`. Legacy version 1 and existing version 2 scenes retain their layout: missing axis values use the original scalar `scale`; opacity defaults to 1, visibility/selectability to true, locking to false, image anchor to `(0.5, 1)`, and pivot to `(0, 0)`.

New axis-scale edits write both axes and mirror X into legacy `scale`. This retains the required legacy field; the new renderer uses the axes when present. Old clients that understand only uniform `scale` cannot reproduce nonuniform scaling. Original image fit sizing/proportions, source URLs, asset IDs, entity IDs, interactions, and extension data are retained. Reading defaults does not rewrite every entity or trigger cloud writes.

Anchor is normalized and supported for images; pivot uses local scene units. Origin edits compensate X/Y so artwork stays visually in place. Inspector dimensions describe unrotated rendered dimensions and edit axis scales rather than adding a second competing size representation. Positive axis values up to 10000 are accepted; handle resizing has a practical positive floor. Imported optional fields and all committed/live numeric transforms are validated.

### Commands and transient sessions

The editor exposes scene-keyed execute/undo/redo, gesture begin/preview/finish/cancel, selection, navigation, and entity operations. Commands retain reversible entity deltas, stable IDs, insertion positions, and selection hints. Undo/redo applies data directly through the project scene-edit gateway and cannot recursively record itself.

Transient sessions contain selection, camera, geometry measurements, and per-scene history. Gesture previews update the viewport/Inspector in memory; completing a valid gesture commits once to the authored scene. Empty, malformed, NaN/Infinity, or out-of-range Inspector text is kept outside authored data, and an invalid focus session is canceled rather than committing its last intermediate value. Pending valid edits finish before scene navigation, save, or export.

Histories remain available when switching scenes during the current browser session. Refresh clears histories. Explicit cloud/recovery replacement clears them; a replacement is refused while a newer gesture is active. A delayed asynchronous creation in another scene does not finish or apply the active scene's transform.

Defaults are 100 commands per scene and a total 16 MiB serialized-command payload budget. Settings are configurable and stored as local editor preferences. Oldest history is pruned; when a required redo predecessor is removed, its dependent redo branch is cleared rather than leaving unusable commands. This is a payload budget, not an exact browser heap measurement.

Committed edits copy only the affected scene/record path, increment its existing generation and dirty tracking, and enter the existing IndexedDB queue. Firebase operations remain explicit and retain the existing revision/fingerprint conflict checks. Undoing placement removes an instance; it does not delete a reusable asset record or uploaded file. Camera, selection, history, gizmos, and loading visuals are not added to gameplay scene data.

### Rendering and input

The React viewport owns a Pixi controller with persistent object nodes keyed by ID. Changes update transforms/properties; sprite/graphics content is rebuilt only when its artwork changes. Separate world layers and overlay graphics keep ordering and editor visuals independent. Original procedural world backgrounds/parallax remain test scenery.

Pointer conversion uses the renderer's client-position mapping and the editor camera for both transforms and asset drops. Pointer capture continues drags past original object/canvas bounds. Move previews are coalesced through animation frames. Listeners are registered once per controller and removed on disposal; observers, pending frames, late texture callbacks, and shared texture acquire/release are cleaned up. StrictMode remounts do not destroy another view's shared texture.

## Verification

Commands:

```bash
npm test
npm run test:emulator
npm run test:browser
npm run build
npm audit --omit=dev
```

Verified on 2026-10-25: **53 unit/component tests passed**, **12 real headless Chrome tests passed** (six scenarios at each device pixel ratio), **8 Firestore/Storage emulator tests passed**, and **the production build plus Hosting output checks passed**. Browser tests also assert that no unhandled page errors occurred. The corrected drop check was additionally repeated at both pixel ratios. The production dependency audit reports zero findings, and demo emulator processes were cleaned up.

A screenshot from the real headless browser was visually inspected for panel layout, canvas/grid/gizmo placement, and Inspector readability. No manual interactive browser session or production Firebase round trip was performed.

| Check | Coverage |
| --- | --- |
| Unit/component | Existing Phase 1/access regressions; geometry inverses; pivot/anchor compensation; scale behavior; history grouping/isolation/pruning; canceled/invalid edits; Inspector transactions; asynchronous scene ownership |
| Firestore/Storage emulators | Existing permissions/legacy/conflict/Trash/image tests plus new property round trips, no transient editor fields, and rejected stale transforms |
| Real headless Chrome | Six scenarios at both device pixel ratios 1 and 2: picking/capture/cancellation/navigation/reload, rotation/scale/origin edits and refresh, lock/visibility/selectability/Mission 1/scene histories, 500 real objects, keyboard/snapping/object commands/export, and native asset drops after zoom/pan |
| Production build | TypeScript, Vite, administrator-gate build configuration, and Hosting output/credential checks |

The browser suite creates isolated browser storage and a development server with Firebase disabled. It exercises actual Pixi rendering and native pointer/wheel/drag events, not a viewport mock. Its tiny colored PNG is a test fixture served only by the test route, not replacement Awalem artwork. Native wheel deltas may differ with browser/device scale; drop assertions use rendered zoom rather than assuming a wheel rate.

Google Chrome is used by default. For bundled Chromium instead, run `npx playwright install chromium`, set `PLAYWRIGHT_CHANNEL=chromium`, and run the browser suite. Other supported installed channels can be selected with the same environment variable. Tests and generated reports/traces stay outside the application build and Git history.

The initial image-test fixture was corrected after the browser rejected its PNG data. A high-DPI drop assertion was corrected to account for Chrome wheel normalization; coordinate tolerances were not widened to hide that difference. Focus/blur tests also caught an accessibility issue where validation text changed the input's label; errors now use `aria-describedby`.

## Files changed

| Area | Files |
| --- | --- |
| Scene schema/validation | `src/data/scene.ts`, `src/features/project/validation.ts` |
| Project integration | `src/features/project/store.ts`, `src/App.tsx` |
| Existing viewport/Inspector | `src/components/SceneViewport.tsx`, `src/components/EntityInspector.tsx` |
| Editor domain/session | `src/features/editor/commands.ts`, `geometry.ts`, `store.ts`, `shortcuts.ts` |
| Pixi implementation | `src/features/editor/controller.ts`, `textures.ts`, `art.ts` |
| Editor controls | `src/features/editor/EditorField.tsx`, `Toolbar.tsx`, `SceneHierarchy.tsx`, `MissionSetup.tsx` |
| Automated tests | `src/features/editor/geometry.test.ts`, `history.test.ts`, `Inspector.test.tsx`, `tests/browser/editor.spec.ts`, `tests/project.emulator.test.ts` |
| Configuration/docs | `playwright.config.ts`, `package.json`, `package-lock.json`, `.gitignore`, `src/style.css`, `README.md`, `PHASE_2.md` |

Some previously compressed source was formatted while integrating the changes. Phase 2 does not change the security-rule files, Firebase initialization/configuration, production access component, Hosting build validators, or bundled content.

## Known limitations and manual checks

- Interactive manual testing in a connected browser and a production Firebase save/load were not performed. Headless Chrome tests do not establish physical touchscreen, Safari/Firefox, mobile layout, or production deployment readiness.
- Selection uses Pixi geometry/texture bounds, not per-pixel alpha testing of transparent sprite pixels. One object is editable at a time. Mirrored/negative scales, grouping, and skeletal/sprite-sheet editing remain later work.
- Scene coordinates remain 960 × 540. Editor panning can go beyond that frame; Fit returns to the scene. Initial image sizing retains the existing 160 × 140 fit box; actual pixels/proportions are preserved.
- History is in memory and deliberately not restored after a browser refresh. Uploaded bytes and catalog metadata remain when instance placement is undone. Project folder/mission CRUD remains outside scene-object history.
- Phase 1's oversized atomic-save guard still applies. The production build still emits the existing large-bundle warning. Five moderate development-tool dependency advisories remain; the production dependency audit is clean.

Manual acceptance checklist:

1. Run `npm run dev`; use **Set up / open Mission 1** and inspect the existing Main Scene under Sea Wonders / Volume 1.
2. Click a real uploaded sprite, click empty space, and select it from the Scene Hierarchy. Check the shared outline/Inspector and lock/visibility behavior.
3. Use W/E/R, axis/corner/rotation handles, snapping/aspect settings, and Inspector values. Confirm Escape cancels and a complete drag undoes in one step.
4. Try keyboard shortcuts after numeric edits and while typing a name. Confirm project-tree shortcuts keep their original meaning.
5. Zoom/pan, drop an existing asset, resize panels, and use Fit/100%. Check positions remain correct.
6. Wait for **Draft saved locally**, refresh, reopen, and confirm rotation/scales/opacity/origins. Switch scenes and confirm separate histories.
7. In an authorized environment, deliberately save/load test content and verify a stale second client receives a conflict. Confirm production builds deny editor access without `studioAdmin: true`.

Next: Phase 3 asset importing/metadata/animation formats and local binary recovery, followed by declarative runtime behaviors. Keep future work on separate feature branches; merging and production deployment remain separate actions.
