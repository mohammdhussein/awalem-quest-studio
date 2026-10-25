# Awalem Quest Studio — 2.5D Web Editor

## Phase 2 scene editing

Use **Set up / open Mission 1** to organize the existing Sea Wonders Main Scene locally. Select objects in the canvas or Scene Hierarchy, then use **W / E / R** for move, rotate, and scale. The Inspector supports independent scales, dimensions, opacity, visibility/locking, and image origins. Camera zoom/pan, grid/angle snapping, aspect locking, and depth controls are available in the scene toolbar.

**Ctrl+Z**, **Ctrl+Y / Ctrl+Shift+Z**, **Ctrl+D**, **Delete**, and **F2** operate in scene context; text fields and the project tree keep their own editing behavior. Each completed drag or valid Inspector focus session is one undo step. Histories are independent per scene during the current browser session and reset on refresh. Authored changes still use the existing local drafts and explicit Firebase save/load.

Run `npm run test:browser` for real headless Chrome tests at device pixel ratios 1 and 2, in addition to `npm test`, `npm run test:emulator`, and `npm run build`. See [PHASE_2.md](PHASE_2.md) for architecture, changed files, verification, limitations, and the manual checklist. Existing production administrator access and Hosting checks remain in force.

## Phase 1 project management

The existing editor now has a persistent project explorer for worlds, volumes, missions, nested folders, scenes, and image asset metadata. Use **+ New**, item action menus, or F2 / Delete / Ctrl+D in the tree. Move content by dragging it onto a container or using **Move**. Moves are restricted to the original volume.

Local drafts save automatically to IndexedDB. Select scenes in the explorer to switch between independent drafts. Existing localStorage scenes migrate to `main`; the original keys remain intact. **Trash** hides branches and supports restoration; externally referenced assets and starting scenes are protected.

**Save to Firebase** explicitly saves pending project records. **Load cloud project** confirms replacement of local changes and stores a recovery snapshot first. **Backup project** exports a portable JSON snapshot, **Export scene** exports the open scene, and **Recovery** exports or restores earlier browser snapshots. New scenes are blank; the original Main Scene examples remain available.

Staff email/password authentication is preserved. Production builds require authentication and a verified `studioAdmin: true` token claim before opening the editor. Local development retains offline editing, and cloud actions also require the administrator claim. Configuration or sign-in alone does not establish live Firebase connectivity. File uploads and Firestore metadata saves have separate success messages.

## Firebase Hosting

Classic Hosting serves `dist` with an SPA fallback. Run `npm run deploy:hosting` only when ready to publish; its predeploy hook builds and checks the production output first, and only Hosting is deployed. On Windows PowerShell use `npm.cmd run deploy:hosting`. See [FIREBASE_HOSTING.md](FIREBASE_HOSTING.md) for environment variables, administrator access, verification, costs, and the current CLI authentication blocker. Deployment has not been performed.

```bash
npm install
npm run dev
npm test
npm run build
# Node 22.12+ or 24+, Java 21+, downloads local emulator JARs on first run:
npm run test:emulator
```

The emulator command always targets `demo-awalem-studio`, uses the unchanged checked-in rules, and never deploys them. Production Firebase configuration and rules are unchanged. See [PHASE_1.md](PHASE_1.md) for architecture, changed files, verification, and remaining limitations.

The sections below describe the original starter and its retained content conventions; the Phase 1 notes above supersede its single-scene/localStorage-only behavior.

Updated from the earlier 3D starter. Browser only; **no Tauri, Three.js, or orbital camera**. The scene editor uses React, TypeScript, Vite, **PixiJS 8**, and the modular Firebase SDK.

## What works in this starter

- Five exact Awalem world IDs and three volumes per world (15 volume directories; no hard-coded maximum in the data model).
- One layered 2.5D scene per volume, with generated demo objects and backgrounds **not claimed as approved Awalem art**.
- Add sample sprites/props, select and drag scene objects, edit X/Y, rotation, size, depth offset, layers, and interaction definitions.
- Y + depth sorting within playfield, separate background/foreground layers, subtle distant-layer pointer parallax.
- Auto-save scene edits to browser localStorage; export scene JSON.
- Optional email/password staff login, Firestore scene save/load, and Cloud Storage sprite upload when Firebase config and security rules are provisioned.
- Placeholder world visual styles; no actual production art or world catalog cards are bundled.

## Local setup

```bash
npm install
cp .env.example .env   # on Windows, copy the file manually
npm run dev
```

Open the localhost URL printed by Vite. In `npm run dev`, the editor works locally **without** a Firebase account. Production builds, including `npm run preview`, require an authenticated studio administrator.

## Firebase setup (web configuration added; live services still need provisioning)

1. Copy `.env.example` to `.env` and fill in the Firebase Web App configuration for project `awalem-quest-studio`. The local `.env` is intentionally excluded from Git. Web configuration identifies the Firebase project but does not create Firestore, Storage, staff accounts, or grant access. Never put Admin SDK private keys in client env variables.
2. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**, create **Cloud Firestore** (production mode), and create **Cloud Storage** if needed (check billing requirements).
3. With Firebase CLI authenticated and this `awalem-quest-studio` project selected, review then deploy: `npx firebase-tools deploy --only firestore:rules,storage`. `firebase.json` has Vite Hosting configuration for later deployment. Do **not** deploy permissive test-mode rules.
4. In Firebase Console → Authentication → Users, create a staff Email/Password user. A trusted Admin SDK/server must then grant this user the custom claim `{ studioAdmin: true }`. Sign out/in to refresh claims. See `FIREBASE_NEXT_STEPS.md`. The browser **cannot** grant this claim.
5. Studio content is stored separately from the production mobile game's accounts, backups and economy records. The web config is **not proof** of active database/storage connectivity until sign-in and cloud read/write are tested.

Firestore scene document path:

`studio_worlds/{worldId}/volumes/{volumeId}/scenes/main`

Storage upload path:

`studio-worlds/{worldId}/volumes/{volumeId}/sprites/{uniqueFileName}`

Real Cloud Storage 'folders' are **object path prefixes**, created when files are uploaded, unlike checked-in project directories.

## Per-volume directory layout

```text
content/worlds/{world_id}/volume_01/  # repeat volume_02 and volume_03
  volume.json
  scenes/
  backgrounds/
  foregrounds/
  parallax/
  sprites/
  sprite_sheets/
  tilemaps/
  animations/
  interactions/
  audio/
  cards/
```

Existing world slugs: `sea_wonders`, `jungle_kingdom`, `birds_of_the_sky`, `desert_kingdom`, `polar_explorers`.

Each `volume.json` includes 20 cards, with rarity target 12 common / 6 rare / 2 epic. Actual cards, final volume names and artwork are intentionally left unfilled until approved content is imported. All volume `is_active` flags remain false per the source spec.

## Scope notes / gaps

- Rendered examples are procedurally drawn test props, not finished Awalem scenes.
- Image uploads need Firebase auth, admin claim and configured Storage. They accept PNG/JPEG/WebP up to 10MB. Image files are not embedded in exported scene JSON; they are referenced by their Firebase download URLs.
- Interaction definitions are editable but **not executed**; a separate game runtime is needed for real educational activities.
- Current studio save format is for internal authoring. It is **not** the Awalem mobile player's SQLDelight database, and cannot overwrite player accounts, purchasing or backup state.
- Treat this as a functional prototype, not a production-ready collaborative editor. Add content validation, publish workflow, version history, app-check, asset processing, backups and tests before launch.

## Source

Structure matches *Awalem Spec 2026*, dated 2026-10-19, and the existing *awalem volumes* Drive folder naming convention.


## After web app registration

The Firebase CLI project selection remains `awalem-quest-studio`; a fresh clone must supply its own local `.env` using `.env.example`. Analytics is intentionally not initialized: it is optional for this internal editor. Firebase client configuration is publicly available in the shipped web application; real access control must come from Authentication, Firestore rules, Storage rules, and server-issued custom claims.
