/**
 * The login page's demo accounts must be the accounts the seed really creates (#47).
 *
 * Why this file is `.mjs`: the assertion needs `node:fs` to read `backend/app/seed.py`, and this
 * package has no `@types/node`, so in a `.ts` test that import is `TS2307` — the fix for which
 * would be a new shared devDependency in `package.json`/`package-lock.json`, the two files every
 * teammate's PR already touches. `tsconfig.json` includes only `src` and sets no `allowJs`, so
 * TypeScript never reads this file while vitest's default include does. No dependency, no config
 * change, same guard.
 *
 * Why paths are computed from `fileURLToPath` instead of `new URL(relative, import.meta.url)`:
 * Vite rewrites exactly that recognized pattern into an asset URL — measured on the first run of
 * this file, where a sibling inside `frontend/` came back as
 * `http://localhost:3000/src/features/auth/LoginPage.tsx` and the seed outside the root came back
 * as `/@fs/C:/…`. Neither is a filesystem path. `import.meta.url` itself is left alone.
 *
 * What it catches that the panel's own test cannot: `App.test.tsx` compares the rendered panel
 * against its own typed copy of the list, so a `seed.py` rename leaves panel and test green
 * together. This file holds no copy — it reads both sources on every run.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url)); // …/frontend/src/test
const FRONTEND = resolve(HERE, "..", ".."); // …/frontend
const REPO = resolve(FRONTEND, ".."); // the worktree root

const SEED = join(REPO, "backend", "app", "seed.py");
const PANEL = join(FRONTEND, "src", "features", "auth", "LoginPage.tsx");
const LABELS = join(FRONTEND, "src", "lib", "labels.ts");

/** Every read refuses out loud: a missing file must not be able to report a clean pair. */
function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `${label} is unreadable at ${path} — this check cannot pass by not looking. (${error.message})`,
    );
  }
}

describe("the login page's demo accounts against the seed", () => {
  // Every character class here excludes newline on purpose: `[^"]+` also matches `\r\n`, and the
  // first measured run of this file proved it — one greedy match swallowed all three panel rows
  // and reported a single account whose "email" was four lines of JSX.
  const seeded = [
    ...read(SEED, "backend/app/seed.py").matchAll(
      /\("(REPORTER|TECHNICIAN|ADMIN)", "[^"\n]*", "([^\s"]+@example\.invalid)"\)/g,
    ),
  // The display name is not captured, so the email is group 2, not group 3 — asserted below by
  // the address-set check, which cannot pass on `undefined`.
  ].map((m) => ({ role: m[1], email: m[2] }));

  const panel = [
    ...read(PANEL, "LoginPage.tsx").matchAll(
      /<code>([^\s"<]+@example\.invalid)<\/code> — \{ROLE_LABELS\.(\w+)\}/g,
    ),
  ].map((m) => ({ role: m[2], email: m[1] }));

  it("reads a non-empty pair from each source", () => {
    // Without this, a regex that stopped matching would compare two empty lists and pass.
    expect(seeded).toHaveLength(3);
    expect(panel).toHaveLength(3);
  });

  it("lists exactly the seeded role/account pairs", () => {
    const key = (a) => `${a.role}=${a.email}`;
    expect(panel.map(key).sort()).toEqual(seeded.map(key).sort());
  });

  it("prints no address the seed does not create", () => {
    // Counted over the whole file, not over the matched rows, so a fourth account cannot be added
    // in prose next to the panel and still satisfy the pair check above.
    const inPanel = [...new Set(read(PANEL, "LoginPage.tsx").match(/[a-z0-9.-]+@example\.invalid/g))];
    expect(inPanel.sort()).toEqual([...new Set(seeded.map((a) => a.email))].sort());
  });

  it("uses role words that ROLE_LABELS actually defines", () => {
    const block = read(LABELS, "lib/labels.ts").match(/ROLE_LABELS[^{]*\{([^}]*)\}/s);
    if (!block) throw new Error("ROLE_LABELS not found in lib/labels.ts — the map moved or was renamed");
    const defined = [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    for (const row of panel) expect(defined).toContain(row.role);
    // The seed's roles and the panel's must be the same set, or an account is listed under the
    // wrong word.
    expect(panel.map((a) => a.role).sort()).toEqual(seeded.map((a) => a.role).sort());
  });
});
