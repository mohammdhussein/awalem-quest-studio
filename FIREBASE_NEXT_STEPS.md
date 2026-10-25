# Firebase connection — next steps

Web app: `Awalem Quest Studio` / Firebase project `awalem-quest-studio`.

## 1. Run locally

Install Node.js LTS. From this project directory:

```bash
npm install
npm run dev
```

For a fresh clone, copy `.env.example` to the ignored local `.env` and fill in the Firebase Web App configuration. Open the address printed by Vite. Local editing works even if Firestore/Auth/Storage are not enabled yet. Configuration and a successful sign-in do not establish cloud connectivity; cloud actions also require `studioAdmin: true`, and save/load report actual service results.

## 2. Enable Firebase services in the console

1. Authentication → Sign-in method → Email/Password → Enable.
2. Authentication → Users → Add user, using an approved studio staff email and a strong password.
3. Build → Firestore Database → Create database → use production mode and appropriate region.
4. Build → Storage → Get started, if asset uploads are needed. Check the current billing prerequisites.

Do not copy/paste private admin credentials or staff passwords into this chat or into any file in `src/`, `public/`, or any `VITE_` environment variable.

## 3. Deploy deny-by-default studio rules

The packaged rules restrict studio content to Firebase Auth users having the **trusted custom claim** `studioAdmin: true`. By default, nobody—including a normal signed-in staff account—can save or upload until the claim is provisioned.

```bash
npx firebase-tools login
npx firebase-tools use awalem-quest-studio
npx firebase-tools deploy --only firestore:rules,storage
```

If Storage isn't provisioned, deploy Firestore first with `--only firestore:rules`; provision Storage before deploying its rules.

## 4. Grant the first studio administrator

A trusted server or Firebase Admin SDK needs to set the Firebase Auth user's custom claim: `{ studioAdmin: true }`. This cannot be set securely by the React client. Ensure your Firebase project administrator performs this step using Google Cloud credentials or another trusted, authenticated environment. The email/password account must already exist. **Never distribute Admin SDK service account JSON/private keys with the web app.**

After the claim is added, sign out and in again. The app's Firestore and Storage operations will then be permitted by the included rules.

## 5. Smoke test

- Select **Sea Wonders → Volume 1**; move a fish or add an object.
- Confirm local auto-save by refreshing the page.
- Sign in with your staff account.
- Click **Save to Firebase**. This writes `studio_worlds/sea_wonders/volumes/volume_01/scenes/main`.
- Click **Load cloud scene**, and confirm the scene returns.
- With Storage provisioned, upload one PNG/JPEG/WebP sprite under 10 MB and confirm it appears.

Cloud Storage objects live at `studio-worlds/<worldId>/volumes/<volumeId>/sprites/<filename>`; these are object path prefixes, not precreated folders.

## Firebase Hosting deployment

```bash
npm run build
npm run deploy:hosting
```

The deployment script targets only Hosting in `awalem-quest-studio`; its predeploy hook rebuilds and checks production configuration and output. On Windows PowerShell use `npm.cmd` / `npx.cmd`. No deployment was performed. See [FIREBASE_HOSTING.md](FIREBASE_HOSTING.md) for the full process, current blockers, and costs.

Production now gates editor access on Firebase Authentication and the verified boolean `studioAdmin: true` claim. Cloud security rules protect data, while Firebase Hosting serves public HTML/JS. Local development retains the existing offline workflow.
