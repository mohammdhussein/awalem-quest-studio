# Missing cloud baseline recovery

## Reported issue

Save reported zero records and conflicts in all five starter worlds, followed by repeated parent-world failures. Read-only production checks found identical starter world/volume metadata at revision 1, plus the original Sea Wonders Main Scene samples at revision 1 with no background configuration. Local drafts without a loaded/acknowledged cloud baseline were incorrectly blocked even where the server had no authored differences.

## Fix

- Missing-baseline records whose validated authored content already matches Firebase are acknowledged without rewriting them. Their current revision and exact fingerprint become the local baseline. Different names, activation/publication flags, deletion state, object data, unsupported schemas, and identities are not treated as identical.
- A missing-baseline local scene at revision 0 may save its authored edits over a revision-1 cloud scene only when that cloud scene exactly matches the bundled starter, including metadata and scene content. This verified first-save starter is a known common ancestor. The comparison is rechecked inside the Firestore transaction on retries.
- Any known stale baseline still conflicts, including when local desired content happens to match the new cloud version. Missing-baseline scenes with authored cloud differences or later cloud revisions still conflict. There is no force-save or automatic cloud replacement.
- Identical metadata does not cause unnecessary writes/revision churn. A volume revision still advances when children are written, retaining the existing scope guard. Partial acknowledgements remain generation-aware, and failed groups retain their drafts.
- The save status reports recovered starter scene baselines. Scene IDs, object IDs, interactions, backgrounds, shared assets, and mission organization are preserved from the local draft.

## Verification

2026-10-25: **81 unit/component tests passed**, **16 Firestore/Storage emulator tests passed**, and **production build/Hosting output checks passed**. New tests cover identical-record acknowledgement without writes, new local scenes, real cloud differences, known stale baselines, local object/background/asset/mission recovery over the initial starter, and refusal to recover later revisions. Existing Phase 3 browser coverage remains documented in PHASE_3.md; this persistence fix did not rerun the unchanged browser interaction suite.

Production diagnostics were read-only. The user's actual browser draft and production-authenticated save have not been inspected or executed by this task. No server content is changed by deploying the fix; recovery occurs when the user explicitly saves.

## User steps

1. Export **Backup project** to preserve the current local work.
2. Refresh the website with **Ctrl+Shift+R**. Existing IndexedDB drafts remain available.
3. Click **Save to Firebase** again. Matching metadata is acknowledged and eligible local starter edits are saved normally.
4. If a genuine scene conflict remains, retain the backup and review the two versions before loading cloud content, because cloud load replaces the working project and clears scene history.

Branch: `fix/cloud-baseline-recovery`, based on the deployed Phase 3 branch. `main`, Firebase rules, production access, and CORS configuration are unchanged.

Deployed 2026-10-25 from source commit `0ae4c50`; Hosting version `c9223d2504c6c71b`. Live read-only checks confirmed HTTP 200, the new `index-BcUpg3Am.js` bundle and recovery status text, the signed-out access gate, and no unhandled page errors. The user's next explicit Save to Firebase applies the transaction recovery to their browser draft; no production scene data was written by the diagnostic/deployment task.
