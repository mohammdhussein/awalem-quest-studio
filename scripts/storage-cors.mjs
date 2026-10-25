// Administrative tooling only. Uses the installed Firebase CLI login; never bundled in the website.
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const cliRoot = resolve("node_modules/firebase-tools/lib");
const auth = require(resolve(cliRoot, "auth.js"));
const { requireAuth } = require(resolve(cliRoot, "requireAuth.js"));
const { Client } = require(resolve(cliRoot, "apiv2.js"));
const project = "awalem-quest-studio",
  bucket = project + ".firebasestorage.app";
const [mode = "--check", file] = process.argv.slice(2);
if (
  !["--check", "--apply", "--restore"].includes(mode) ||
  (mode === "--restore" && !file)
)
  throw new Error("Use --check, --apply, or --restore <backup file>.");
const options = { project },
  account = auth.getProjectDefaultAccount(process.cwd());
if (!account)
  throw new Error(
    "Run npx firebase-tools login with a project administrator account.",
  );
auth.setActiveAccount(options, account);
await requireAuth(options, true);
const client = new Client({ urlPrefix: "https://storage.googleapis.com" }),
  path = `/storage/v1/b/${bucket}`;
const current = (
  await client.get(path, {
    queryParams: { fields: "name,cors,metageneration" },
  })
).body;
const desired = JSON.parse(await readFile("storage.cors.json", "utf8"));
const covers = (current.cors ?? []).some(
  (rule) =>
    desired[0].origin.every((origin) => rule.origin?.includes(origin)) &&
    desired[0].method.every((method) => rule.method?.includes(method)),
);
if (mode === "--check") {
  console.log(
    JSON.stringify(
      {
        bucket,
        configured: covers,
        cors: current.cors ?? [],
        metageneration: current.metageneration,
      },
      null,
      2,
    ),
  );
  if (!covers) process.exitCode = 2;
} else if (mode === "--apply" && covers)
  console.log(
    "Storage CORS already permits the two configured Hosting origins.",
  );
else {
  let policy =
    mode === "--apply" ? [...(current.cors ?? []), ...desired] : null;
  if (mode === "--restore") {
    const backup = JSON.parse(await readFile(file, "utf8"));
    if (
      backup.bucket !== bucket ||
      backup.appliedMetageneration !== current.metageneration
    )
      throw new Error(
        "Bucket policy changed since this backup. Review it before restoring.",
      );
    policy = backup.cors;
  }
  await mkdir(".firebase", { recursive: true });
  const backupPath = resolve(".firebase", `cors-backup-${Date.now()}.json`);
  const backup = {
    bucket,
    cors: current.cors ?? [],
    metageneration: current.metageneration,
    appliedMetageneration: null,
  };
  await writeFile(backupPath, JSON.stringify(backup, null, 2));
  const changed = await client.patch(
    path,
    { cors: policy },
    {
      queryParams: {
        ifMetagenerationMatch: current.metageneration,
        fields: "name,cors,metageneration",
      },
    },
  );
  backup.appliedMetageneration = changed.body.metageneration;
  await writeFile(backupPath, JSON.stringify(backup, null, 2));
  const verified = (
    await client.get(path, { queryParams: { fields: "cors,metageneration" } })
  ).body;
  if (JSON.stringify(verified.cors ?? []) !== JSON.stringify(policy))
    throw new Error("CORS read-back did not match. Inspect the bucket policy.");
  console.log(
    JSON.stringify(
      {
        bucket,
        updated: true,
        backup: backupPath,
        metageneration: verified.metageneration,
      },
      null,
      2,
    ),
  );
}
