# CampusFix — frontend scaffold (#48)

Vite + React 18 + TypeScript, with the stack Baseline §13.2 fixes: **TanStack Query** for
server state, **Auth Context** for the session, **React Hook Form + Zod** for forms, and API
types **generated from the OpenAPI contract** rather than typed by hand. No Redux, no Zustand.

This branch carries the **scaffold** and the login page, not the application: of the nine pages
Baseline §13.1 lists, only `/login` is built, and the other eight render `UnbuiltPage`, which
names the page's owner. The route table and the role gates are complete, so navigation, the
Mock mount point and the request layer are all usable before any screen lands — which is the
point of #48 landing first.

Read [`CONVENTIONS.md`](./CONVENTIONS.md) before adding anything: it says which directory belongs
to whom, how requests must be made, where the Mock layer attaches, and how to re-generate the
API types when #46 freezes.

## Run

```bash
npm install
npm run gen:api                # regenerate src/api/generated/schema.d.ts from the contract
npm run dev                    # http://localhost:5173, proxies /api to the backend
npm run test                   # vitest
npm run build                  # tsc -b && vite build
```

`npm run dev` works with no backend running: the boot probe `GET /api/me` fails through the
proxy and the app renders the login page. That is the intended cold start.

### Generating the API types

`gen:api` reads `docs/api/openapi.yaml` — which is issue **#46**'s deliverable and is not on
`main` yet (it is in the draft PR from `base-auth`). Until it merges, point the script at a
local copy of the reviewed YAML:

```bash
CAMPUSFIX_CONTRACT=/path/to/openapi.yaml npm run gen:api
```

The generated `src/api/generated/schema.d.ts` **is** committed, with a header recording the
contract version and a digest of the exact YAML it came from, so the tree builds without the
contract file present and everyone can tell which draft produced it. When #46 freezes: pull the
merged YAML, run `npm run gen:api`, and fix whatever `src/api/index.ts` reports — that seam is
the only place app code references the generated types.

### Developing against fixtures instead of the backend

```bash
VITE_USE_MOCK=1 npm run dev     # Git Bash / Linux / macOS
cmd /c "set VITE_USE_MOCK=1&& npm run dev"   # Windows cmd
```

The switch is read per request, so it can be flipped inside a test. With the flag off — or with
no responder installed — requests go to `/api` exactly as they would in production. The responder
itself is 舒玺悦's Mock layer (#48's other half); see CONVENTIONS.md §4.

### Talking to a real backend

The dev proxy targets the web container's published port (default `http://localhost:8080`),
because that is what `docker compose up` exposes; the API service itself stays on the internal
network. Run `VITE_API_TARGET=http://localhost:8000 npm run dev` to point at a host-run FastAPI
instead. Backend environment setup — database, cookie key, attachment path, allowed origins —
belongs to issue #45, and nothing here carries a default secret.

One consequence worth knowing before your first write request: the contract requires an allowed
`Origin` on every write. Browsers send their own, so a dev server on `:5173` arrives as
`Origin: http://localhost:5173` and answers **403 `ORIGIN_NOT_ALLOWED`** unless #45's
`ALLOWED_ORIGINS` includes it. The frontend must not work around that by hand — CONVENTIONS.md §5.

## What is here

| Path | Contents |
| --- | --- |
| `src/api/generated/` | types generated from the contract; never edited, never imported directly |
| `src/api/index.ts` | the seam: the only place app code may reach contract types |
| `src/api/client.ts` | the only `fetch` call site; envelope parsing, `ApiError`, 401 hook |
| `src/api/endpoints.ts` | one function per declared operation, cursor paging, bare payloads |
| `src/api/mockBridge.ts` | the Mock **mount point**: one switch + one interceptor interface |
| `src/app/` | providers, the nine-page route table, error boundary, route guards, state pages |
| `src/lib/queryClient.ts` | TanStack Query client, query keys, §13.3's 409 behaviour |
| `src/lib/labels.ts` | presentation vocabulary, keyed to the generated enums |
| `src/features/auth/` | login page (RHF + Zod) and session context — behaviour is issue #47 |
| `src/components/` | the three files the shell needs today; the shared component library is 舒玺悦's |
| `src/test/` | frontend test evidence, per AGENTS.md §6 |

Container files (`Dockerfile`, `nginx.conf`) are **not** here: serving the built SPA is issue
#45's scope, and it already has its own branch.
