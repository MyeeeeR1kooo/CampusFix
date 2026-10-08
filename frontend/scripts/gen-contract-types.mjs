/**
 * Generates the frontend's API types from the OpenAPI contract (#48).
 *
 * Baseline §13.2 forbids hand-written enums and fields, so `src/api/generated/schema.d.ts`
 * is a build artefact rather than something anyone edits. It is produced with the same
 * `openapi-typescript` version the contract tooling uses (tools/api-contract pins 7.10.1),
 * so the frontend and #46's own check cannot drift apart by generator version.
 *
 * The spec path defaults to docs/api/openapi.yaml, which only exists once #46 merges.
 * While the contract is still a draft, point CAMPUSFIX_CONTRACT at a local copy of the
 * reviewed YAML; the revision recorded in the header says which draft the committed
 * types came from, so a later freeze is a re-run plus one diff, not an archaeology job.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const repoRoot = resolve(frontend, "..");

const spec = process.env.CAMPUSFIX_CONTRACT
  ? resolve(process.env.CAMPUSFIX_CONTRACT)
  : join(repoRoot, "docs", "api", "openapi.yaml");

if (!existsSync(spec)) {
  console.error(
    [
      `Cannot find the API contract at ${spec}.`,
      "",
      "docs/api/openapi.yaml is issue #46's deliverable and is not on main yet.",
      "Until it merges, generate from the reviewed draft:",
      "  CAMPUSFIX_CONTRACT=<path-to-openapi.yaml> npm run gen:api",
      "",
      "Do not hand-edit src/api/generated/schema.d.ts to work around this.",
    ].join("\n"),
  );
  process.exit(1);
}

// Resolved by path, not by specifier: openapi-typescript's "exports" maps "./*.js" to
// "./*.mjs", so `require.resolve("openapi-typescript/bin/cli.js")` cannot see its own CLI.
const cli = join(frontend, "node_modules", "openapi-typescript", "bin", "cli.js");
if (!existsSync(cli)) {
  console.error(`openapi-typescript CLI not found at ${cli}. Run npm install first.`);
  process.exit(1);
}
const out = join(frontend, "src", "api", "generated", "schema.d.ts");
const tmpOut = join(mkdtempSync(join(tmpdir(), "campusfix-types-")), "schema.d.ts");

const run = spawnSync(process.execPath, [cli, spec, "-o", tmpOut], { stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);

const specText = readFileSync(spec, "utf8");
const version = specText.match(/^ {2}version:\s*(\S+)/m)?.[1] ?? "unknown";
const digest = createHash("sha256").update(specText).digest("hex").slice(0, 12);
const logicalPath = spec.startsWith(repoRoot) ? spec.slice(repoRoot.length + 1) : "docs/api/openapi.yaml";

const header = [
  "/*",
  " * CampusFix #48 — generated API types. Run `npm run gen:api`, never edit by hand.",
  ` *   contract version : ${version}`,
  ` *   contract digest  : sha256:${digest}`,
  ` *   contract source  : ${logicalPath}`,
  ` *   generated at     : ${new Date().toISOString()}`,
  " *",
  " * The digest is the anchor while #46 is unmerged: two runs over the same YAML differ only",
  " * by timestamp, and any contract edit changes it. Record the upstream commit in the commit",
  " * message that regenerates this file, not here.",
  " *",
  " * Import these through src/api/index.ts. Nothing else may reference this path, so a",
  " * contract freeze is a re-run plus one file of fallout, not a sweep across the app.",
  " */",
  "",
].join("\n");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, header + readFileSync(tmpOut, "utf8"));
console.log(`Wrote ${out}`);
