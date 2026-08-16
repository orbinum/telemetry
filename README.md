# Orbinum Telemetry

Live telemetry for Orbinum network nodes — block height, finalized blocks,
peers, transactions, propagation, version and location. Own replacement for
`telemetry.polkadot.io`.

One repository, two deploys on Cloudflare:

| Package                 | Deploy | Domain                      |
| ----------------------- | ------ | --------------------------- |
| [`backend/`](backend)   | Worker | `telemetry.orbinum.io`      |
| [`frontend/`](frontend) | Pages  | `telemetry.orbinum.network` |

A single deploy serves testnet and mainnet; the UI filters between them.
[`shared/`](shared) holds the wire contract both sides compile from source —
it is not a package and has no build step of its own.

## Getting started

Each package keeps its own lockfile, so install them separately:

```sh
pnpm install:all       # or: pnpm -C backend install && pnpm -C frontend install
pnpm dev:back          # worker on :8787
pnpm dev:front         # UI on :5173
```

Point a node at the local worker to see real data:

```sh
orbinum-node --dev --tmp --name my-node \
  --telemetry-url "ws://127.0.0.1:8787/submit/ 1"
```

## Checks

`pnpm check` runs the same gate as CI, per package: lint → typecheck →
format check → build → test.

```sh
pnpm check             # both packages
pnpm lint              # or any single step across both
pnpm -C backend check  # one package only
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs backend and
frontend as parallel jobs, so a failure in one still reports the other. The
backend job additionally verifies that `worker-configuration.d.ts` matches
`wrangler.jsonc` — stale binding types would otherwise only surface at deploy
time.

## Deploy

**A release deploys itself.** Cutting one (below) tags the commit and then
publishes both halves from CI, worker first — it owns the wire contract the UI
compiles against, so a UI ahead of its worker is the ordering that breaks.
Nothing reaches Cloudflare until every check on that exact commit is green.

This needs two repository secrets, under the `production` environment:

| Secret                  | What it is                                      |
| ----------------------- | ----------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Token with Workers Scripts + Pages edit rights  |
| `CLOUDFLARE_ACCOUNT_ID` | The account the worker and Pages project are in |

**Neither project may keep Cloudflare's Git integration.** Connected to the
repository, Pages and Workers each build on their own the moment `main`
moves — before CI has said anything, and in parallel with the deploy here.
That is two deploys of one commit racing, and the ungated one can win. Both
are disconnected in the dashboard, which makes this workflow the only path to
production and is what makes the gate above worth anything.

Deploying by hand still works, and is what you want for a rollback or a
worker-only fix:

```sh
pnpm deploy:back       # wrangler deploy → telemetry.orbinum.io
pnpm deploy:front      # build + wrangler pages deploy
```

Both need `wrangler login`.

## Releasing

**One version for the whole repo**, in the root `package.json` — the packages
carry none of their own. The worker and the UI compile the same wire contract
from [`shared/`](shared) and deploy together, so they cannot be at different
versions in any meaningful sense.

1. Add the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md)
   as you make them. This does not trigger anything.
2. To cut a release, rename that heading to `## [x.y.z] - YYYY-MM-DD`, add a
   fresh empty `## [Unreleased]` above it, update the link definitions at the
   bottom, and bump `version` in the root `package.json`.
3. Push to `main`. [`release.yml`](.github/workflows/release.yml) verifies the
   version, **calls `ci.yml` on that same commit**, and only then tags
   `vx.y.z`, publishes a GitHub Release whose notes are that CHANGELOG
   section, and deploys the worker and the UI.

Nothing is tagged, published or deployed unless CI is green: the release
invokes the CI workflow as a reusable workflow rather than repeating its
steps, so the two gates cannot drift apart.

Only a version bump releases. The workflow watches the root `package.json`,
refuses to run without a matching CHANGELOG section, and stops if the tag
already exists — so editing scripts or the Unreleased notes never re-releases.

## More

- [`backend/README.md`](backend/README.md) — environment variables, routes and
  the public-endpoint limits.
