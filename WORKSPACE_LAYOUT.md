# Customizable workspace and larger scene view

## Branch and defaults

Implemented on `feature/editor-workspace-layout`, based on the latest cloud-recovery commit `359a063`. The change retains the existing 960 × 540 scene dimensions. `main`, Firebase persistence/recovery, rules, CORS, production access, and game content are unchanged.

The first desktop visit opens both sidebars and collapses the Asset Browser. Existing saved sidebar widths are reused. Saved workspace preferences override these defaults on subsequent visits.

## Controls and behavior

- **Left panel**, **Inspector**, **Assets**, and **Scene focus** stay in the breadcrumb toolbar, separate from the scrolling editing-tool strip. Each sidebar can collapse independently and gives its space to the canvas. Its searches, selection, filters, and Inspector remain mounted.
- The Asset Browser collapses to a 36 px header that keeps **Upload sprite** and upload progress available. Its default expanded height is 240 px. Drag the horizontal divider or use Up/Down (10 px), Home, and End to resize it. Sidebar dividers support Left/Right, Home, and End. Pointer cancellation/Escape restores a divider's starting size.
- Expanded assets are limited to 45% of workspace height while reserving at least 260 px for the canvas where possible. Short windows temporarily collapse the drawer without discarding the preferred height/open state. Extremely wide desktop sidebar preferences are temporarily constrained to leave 360 px for the center; stored preferred widths are preserved.
- Desktop chrome is compact: approximately 56 px application header, 36 px breadcrumbs, an editing-tool strip, and the status footer. Long editing toolbars scroll horizontally instead of wrapping into many rows.
- **Scene focus** temporarily hides both sidebars and the entire Asset Browser and fits the scene. Toggling it off restores the previous layout and camera. Opening a panel during focus restores normal mode with that panel shown. Focus state is not persisted across refreshes.
- Below 1100 px, sidebar buttons open overlays one at a time. Both toolbar rows remain accessible above the overlays. Use the close button, backdrop, or Escape outside an active input/dialog to close. Keyboard focus returns to the appropriate sidebar button. Returning to desktop width restores desktop preferences.
- **Settings → Workspace** stages visibility and preferred asset height until **Apply settings**. Cancel preserves the previous settings. **Reset workspace** is an explicit immediate reset of visibility, sidebar widths, asset height, and Fit; it does not reset grid/history settings or change scene data.

## Camera and editing safety

Each scene session has a Fit/manual camera policy and the viewport size associated with its camera. Fit is the default and adapts to panel/window resizing using the existing 48 px total framing allowance. Wheel zoom, pan, and 100% enable manual mode. Manual resizing preserves zoom and the world point at viewport center; **Fit** enables automatic fitting again.

Parallax previews retain their prior camera policy and viewport when stopped. Layout changes stop previews, commit valid pending Inspector edits, and cancel unfinished pointer drags/invalid edits safely. Focus mode restores its camera snapshot with the appropriate viewport conversion. Scene selection, object transforms, backgrounds, mission data, history, generations, and cloud dirty state are unaffected by panel operations alone.

## Architecture and files

- `src/features/editor/workspace.ts` owns versioned browser-only preferences, size constraints, compact overlays, focus snapshots, and layout preparation. `WorkspaceControls.tsx` and `WorkspaceSettings.tsx` integrate the UI.
- Preferences use `awalem-workspace-v1` for visibility/asset height and the existing `awalem-panel-left`/`awalem-panel-right` width keys. Unsupported/malformed data or inaccessible storage falls back to safe defaults. A preference-storage failure does not block editing.
- `src/App.tsx` keeps panels and the upload input mounted, measures available space, and coordinates the grid/drawer. `src/components/PanelDivider.tsx` provides accessible pointer/keyboard resizing and cancellation.
- `src/workspace.css`, loaded after the legacy styles, overrides conflicting minimum-size/forced-grid rules and supplies explicit grid placement, overlays, collapsed states, and compact chrome.
- Editor geometry, controller, session store, and Toolbar implement resize-aware camera policies, preview restoration, settings, and cancellation. Resize observers, media-query listeners, and workspace event listeners are cleaned up.
- New workspace unit/component/browser tests accompany small changes to the existing App/background tests and browser setup, which now open Assets explicitly when required. Existing phase reports remain historical records.

No authored schema, Firebase document path, security policy, framework dependency, or application initialization change is included. Scene camera/workspace state is not serialized into exports or Firebase.

## Verification

Commands: `npm test`, `npm run test:emulator`, `npm run test:browser`, `npm run build`, and `npm audit --omit=dev` (use `.cmd` on this PowerShell installation).

Verified 2026-10-25:

| Check | Result |
| --- | --- |
| Unit/component | **105 passed in 13 files**. Includes defaults, malformed/denied preference storage, visibility/width retention, overlays, staged settings/reset, focus restoration, keyboard resizing, camera math, preview restoration, pending edits/cancellation, and uploads continuing with collapsed assets. App/viewport/uploader mocks are distinguished from browser tests below. |
| Firestore/Storage emulators | **16 passed**, preserving the cloud-recovery, conflict, permissions, shared-asset, background, and partial-save regressions against unchanged rules in `demo-awalem-studio`. Expected access-denial warnings are negative tests. |
| Real browser | **36 Chrome tests passed**: existing editor/background/CORS/500-object tests plus workspace tests at 1440 × 900, 1280 × 800, and 1024 × 768, at device pixel ratios 1 and 2. Tests verify real canvas dimensions, framing, gizmos, asset drops after resizing, keyboard/pointer dividers, overlay access, undo, unchanged exports, and refresh recovery. |
| Production build | TypeScript, Vite, administrator configuration, and Hosting output/credential checks passed. The known large-bundle warning remains. |
| Production dependencies | `npm audit --omit=dev`: **0 vulnerabilities**. |

The narrow overlay initially intercepted editing-toolbar clicks. Real Chrome automation caught it; overlays/backdrops now begin below both toolbar rows. Asset-drop coverage also checks coordinate conversion after the Inspector changes canvas width. Browser storage is isolated and its development build has Firebase disabled.

Normal, expanded-assets, focused, and narrow-layout screenshots are generated under ignored `test-results/` and were visually inspected for canvas size, artwork, panel readability, and persistent controls. No interactive authorized production-session or cloud round trip is inferred from these tests.

## Rollout and limitations

Deployed 2026-10-25 from source commit `9dc0273` on `feature/editor-workspace-layout`. Hosting version: `4c498c5ceaceebb6`. The Hosting predeploy hook rebuilt and verified the production output successfully; only Hosting was deployed.

Read-only live checks confirmed the new `index-CggLngb2.js` bundle and `index-BollTAor.css`, workspace/focus/reset controls, workspace layout styles, and retained cloud-recovery code. Root and `/studio/worlds/sea_wonders` returned HTTP 200 and showed the sign-in gate with no editor canvas in an isolated signed-out Chrome session. No unhandled page errors occurred. An authenticated studio-admin browser session was not available, so signed-in production layout/cloud round-trip checks remain manual; the 36 real browser tests use isolated development mode.

Previous Hosting version: `c9223d2504c6c71b`, release `1792954111337000`. Use Firebase Console → Hosting → release history → previous release → Roll back if needed. Before/after Hosting receipts and live verification results are saved in ignored `.firebase/workspace-hosting-before.json`, `workspace-hosting-after.json`, and `workspace-live-verification.json`.

The feature branch is pushed; `main` remains unchanged. No production scene/asset content, Firebase rules, CORS policy, or administrator claims were modified by this task.

Workspace controls are available in the authenticated editor. The login screen intentionally does not expose them. Desktop visibility preferences are retained independently of compact overlay state. Cameras/history remain per browser session; layout preferences persist locally. Browser-private modes may prevent preference persistence while editing continues in memory.

Small-screen overlays improve access but do not establish touch, Safari/Firefox, or phone-layout support; actual automation uses headless desktop Chrome. Scene dimensions stay fixed, and the canvas may letterbox the 16:9 authored scene. Use Scene focus or collapse sidebars to gain width as well as height.

Manual acceptance: refresh the hosted editor, open a scene, toggle every panel, resize dividers, use Scene focus and Settings → Workspace, then test zoom/pan, Inspector edits, background layers, uploads, and asset drops. Refresh again to confirm local layout preferences and scene drafts. Verify cloud save/load separately in an authorized studio-admin session when available.
