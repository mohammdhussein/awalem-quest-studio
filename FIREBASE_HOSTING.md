# Firebase Hosting deployment

This repository uses **Firebase Hosting (Classic)** for the existing project
`awalem-quest-studio`. It serves the React/TypeScript/Vite/PixiJS build in `dist`.
No App Hosting backend, Cloud Run service, new project, or framework migration is
needed. Do not run `firebase init` over this configured repository.

## Preserved configuration

- `.firebaserc` still selects `awalem-quest-studio`.
- `firebase.json` retains the Firestore and Storage rule references, Hosting ignore
  list, `public: "dist"`, and `**` rewrite to `/index.html`.
- Hosting now has a `predeploy` hook that runs `npm run build`. A failing build or
  output check stops the deployment before uploading Hosting content.
- The Firestore/Storage rules, `firebase.emulators.json`, Firebase initialization,
  local `.env`, content files, and existing editor implementations are retained.
- `deploy:hosting` explicitly selects the project and `--only hosting`. It does
  not deploy rules, change Firestore data, or run migrations.

The SPA rewrite serves the app shell for direct navigation and refreshes at nested
URLs. It does not add a new client router or change the editor's existing selection
behavior. Existing static files take precedence over the fallback.

## Build configuration and credentials

Use Node 22.12+ or Node 24+. Use the checked-in lockfile with `npm ci` on a fresh
checkout. For local setup, copy `.env.example` to `.env.local` if no configuration
already exists; do not replace an existing `.env`.

Production requires these public Firebase Web App values:

| Variable | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase Web App API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Authentication domain |
| `VITE_FIREBASE_PROJECT_ID` | Must be `awalem-quest-studio` |
| `VITE_FIREBASE_APP_ID` | Registered Firebase Web App ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Needed for sprite uploads; otherwise optional |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Optional Web App configuration |
| `VITE_FIREBASE_MEASUREMENT_ID` | Optional; Analytics remains uninitialized |

Vite loads `.env`, `.env.local`, `.env.production`, and `.env.production.local`
for a normal production build. Mode-specific files override general files;
variables already set in the build shell have the highest priority. In CI, supply
the same Web App values to the build job. Hosting does not inject environment
variables into an already-built static application. Rebuild when configuration
changes. Environment files other than `.env.example` are ignored by Git.

The build rejects missing or placeholder required values, the wrong project,
non-production `NODE_ENV`, recognizable private credentials, and sensitive
`VITE_` variable names. Its output check verifies that all supplied Firebase Web
App values reached the production JavaScript and scans `dist` for credential
files and private-key/service-account signatures. Values are not printed.
Signature checks are an extra safeguard, not a guarantee against every secret
format; review newly added client code and assets before publishing.

Every `VITE_` value is public browser configuration. Firebase Web App API keys are
public identifiers; access comes from Firebase Authentication and server-side
rules. Never put service account JSON, private keys, Admin SDK credentials, staff
passwords, or private API tokens in `src`, `public`, `dist`, or `VITE_` variables.
Authenticate the Firebase CLI separately; keep any CI deployment credential only
in the CI runner's trusted environment.

See [Vite environment documentation](https://vite.dev/guide/env-and-mode).

## Administrator access

Every production build, including `npm run preview`, blocks the editor until
Firebase Authentication resolves and the ID token has the boolean custom claim
`studioAdmin: true`. Signed-out users see the staff login form; signed-in users
without the claim see denied access, Refresh access, and Sign out. Missing
configuration, token errors, and pending permission checks keep the editor closed.
Signing out or losing the claim on a token update closes the editor.

`npm run dev` retains the existing offline/local editor workflow. This development
behavior is removed by the production build. Existing cloud operations still call
`requireStudioAdmin`; unchanged Firestore and Storage rules require the same claim
and deny unrelated paths. Only a trusted administrator/server may grant claims;
refresh the user's token or sign out/in afterward.

Classic Hosting serves public HTML, JavaScript, and styles. The gate controls
normal editor access; deployed security rules enforce cloud data access even if
someone modifies the browser code. This is not a private network or protection
for the downloadable application source. If the static files themselves must be
private, a separate authenticated serving layer would be needed.

## Verify before deployment

```bash
npm test
npm run test:emulator
npm run build
```

The emulator tests need Java 21+ and use only `demo-awalem-studio` with the existing
Firestore and Storage emulator configuration. They verify authorized operations,
ordinary/signed-out denial, data compatibility, conflicts, and image uploads
without touching production. The component tests also cover the production access
gate and retention of the existing local workflow.

For a local Hosting routing check after building:

```bash
npx firebase-tools emulators:start --only hosting --project demo-awalem-studio
```

Open `http://127.0.0.1:5000/` and a nested URL such as
`http://127.0.0.1:5000/studio/worlds/sea_wonders`. Both should load the login gate;
refreshing the nested URL should work. Stop the emulator with Ctrl+C. Do not enter
production credentials during this local routing check: the compiled Web App
configuration still points to production Auth/Firestore/Storage, and starting only
the Hosting emulator does not redirect those SDK services.

Before the first live deployment, a project administrator should confirm:

1. Their CLI account can access the existing Hosting site in `awalem-quest-studio`.
2. Email/Password authentication is enabled and the intended hosted domain is
   authorized in Firebase Authentication settings. Verify the actual Auth domain
   configuration in the console, especially for custom domains.
3. At least one approved staff user has `studioAdmin: true` from a trusted server.
4. The live Firestore and Storage rules match the reviewed administrator-only
   policy. A Hosting-only deployment intentionally does not update these rules.
5. Firestore and, if uploads are needed, Storage are provisioned; Storage has the
   required billing plan. Review billing and project usage before enabling costs.

## Deploy only when ready

Authenticate once using a project-authorized account:

```bash
npx firebase-tools login
npx firebase-tools hosting:sites:list --project awalem-quest-studio
```

Then, from this repository root, the exact deployment command is:

```bash
npm run deploy:hosting
```

On this Windows PowerShell installation, script execution policy blocks `npm.ps1`
and `npx.ps1`. Use `npm.cmd` and `npx.cmd` without changing execution policy:

```powershell
npx.cmd firebase-tools login
npx.cmd firebase-tools hosting:sites:list --project awalem-quest-studio
npm.cmd run deploy:hosting
```

The deployment script expands to
`firebase deploy --only hosting --project awalem-quest-studio`; the predeploy hook
builds and checks `dist` first. Use the URL reported by the CLI. For the default
site it is expected to be `https://awalem-quest-studio.web.app` (also
`https://awalem-quest-studio.firebaseapp.com`). No deploy command was run during
this preparation.

After an intentional deployment, verify signed-out denial at both root and nested
URLs, denial for a non-admin account, and successful entry for an administrator.
Confirm existing cloud access with an approved test workflow; cloud saves and
uploads write real data and should be deliberate.

## Readiness and costs (2026-10-25)

Preparation verification passed:

- `npm.cmd run build`: TypeScript, Vite, and production output verification.
- `npm.cmd test`: 35 tests in 6 files, including production access and environment
  checks plus the existing editor/project/persistence tests.
- `npm.cmd run test:emulator`: 7 Firestore/Storage tests against unchanged rules.
- The local Classic Hosting emulator returned the production app shell at `/`
  and two nested URLs, including a query string; JavaScript assets served with
  the correct content type.
- Actual Vite builds refused a missing Auth domain, wrong project, development
  `NODE_ENV`, and a sensitive `VITE_SERVICE_ACCOUNT` variable.

Vite still reports the existing large JavaScript chunk warning (approximately
1.14 MB before compression); it does not block deployment. No browser was
connected, so live visual/PixiJS checks remain manual. These checks did not sign
in to production or write production content.

The local production Web App configuration is present for all seven listed
variables. Build and local tests establish repository readiness; they do not
establish live service provisioning, deployed rules, administrator claims, or
billing status. The read-only Hosting site lookup failed with
`Failed to authenticate, have you run firebase login?`; CLI authentication and
confirmation of the live prerequisites above remain blockers to verified live
readiness. No production data was read or written.

Classic Hosting can use the Spark plan within its no-cost quotas. Firebase's
Hosting usage guide lists 10 GB stored and 10 GB/month data transfer at no cost;
Blaze overages are $0.026/GB stored and $0.15/GB transferred. Retained releases
count toward Hosting storage. Spark can block new deploys at the storage limit
and disable serving after its transfer allowance/grace period. The pricing table
also expresses the transfer allowance as 360 MB/day; confirm the applicable
quota in the project's console before launch. Sources:
[Hosting usage and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing),
[Firebase pricing](https://firebase.google.com/pricing).

Firestore reads/writes/storage, Authentication usage, and Cloud Storage have
their own pricing and quotas. **Cloud Storage for Firebase requires Blaze**, even
though no-cost usage can still apply; image uploads/downloads can incur charges.
The actual project plan and region were not accessible. This setup does not
provision App Hosting, Cloud Run, or Cloud Build. See
[Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).
