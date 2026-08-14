# Orbinum Telemetry — worker

Node ingest (`/submit`) and browser feed (`/feed/:genesisHash`) for
`telemetry.orbinum.io`, on Cloudflare Workers + Durable Objects.

```sh
pnpm dev              # wrangler dev on :8787
pnpm check            # lint + typecheck + fmt + build + test
pnpm deploy           # deploys to telemetry.orbinum.io
pnpm cf-typegen       # regenerate CloudflareBindings after editing wrangler.jsonc
```

## Routes

| Route                     | Purpose                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /submit`, `/submit/` | Node telemetry WebSocket upgrade (both spellings — the chainspec multiaddr resolves with a trailing slash) |
| `GET /feed/:genesisHash`  | Browser feed WebSocket, routed straight to that chain's `ChainDO`                                          |
| `GET /chains`             | Chain directory for the UI's picker (CORS-enabled)                                                         |

## Architecture

A node's chain is unknown until its first `system.connected`, which arrives
_after_ the WebSocket upgrade. Someone has to hold the socket, parse, and only
then know where the messages belong — that is the `GatewayDO`, partitioned by
client IP. Per-chain state lives in a `ChainDO` keyed by genesis hash.

```
node ──ws──> Worker ──> GatewayDO ──rpc──> ChainDO ──ws──> browser
                        (sockets,          (state,
                         routing,           aggregates,
                         limits)            feed fanout)
```

| Directory     | Holds                                                               |
| ------------- | ------------------------------------------------------------------- |
| `protocol/`   | Parser for the node wire format. Pure; one file per message variant |
| `domain/`     | Node and chain state, propagation, bounded series. Pure, no I/O     |
| `gateway-do/` | Node sockets, ingest policy, chain directory                        |
| `chain-do/`   | Per-chain state owner, feed batching and fanout                     |
| `feed/`       | Domain → wire serialization for browsers                            |
| `routes/`     | HTTP handlers; they route and validate, never parse telemetry       |
| `middleware/` | CORS, rate limiting, and geo across the Worker→DO boundary          |
| `services/`   | Which Durable Object owns what                                      |
| `config/`     | Allowlist and limits                                                |

`tests/` mirrors `src/`, plus `tests/security/` for adversarial input. 222
tests total; run them with `pnpm test`.

## Environment variables

The deployed values live in `wrangler.jsonc` under `vars`. Locally, copy
[`.dev.vars.example`](.dev.vars.example) to `.dev.vars` — `wrangler dev` reads
it and it overrides that block. All are optional; all are validated, and
invalid entries are ignored rather than crashing the worker.

| Variable                    | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `TELEMETRY_TESTNET_GENESIS` | Testnet genesis hash for the allowlist              |
| `TELEMETRY_MAINNET_GENESIS` | Mainnet genesis hash — empty until mainnet launches |
| `TELEMETRY_CHAINS`          | Comma-separated extras, for a fork under test       |

**Leaving all three empty means the worker accepts nodes from any chain.**
That is deliberate — a `--dev` node gets a fresh genesis on every restart, so
local development would be impossible otherwise — and the `GatewayDO` logs a
warning at startup when it happens. Production must set at least the testnet
hash.

Devnet is not configured here. Its genesis changes on every node restart, so
it could never be allowlisted; a developer runs their own worker instead
(`pnpm dev`, empty allowlist) and the UI's Devnet tab points at it.

Genesis hashes belong in config, not in code: testnet's has already changed
once (the value in `node-deploy/docs/TOPOLOGY.md` is stale). Read the current
one from a live node:

```sh
curl -s -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"chain_getBlockHash","params":[0]}' \
  https://rpc-1.testnet.orbinum.io
```

## Deploy

`pnpm deploy` from this directory, or connect the repository in the Cloudflare
dashboard (Workers → Create → Import a repository) so every push to `main`
deploys:

| Field                              | Value             |
| ---------------------------------- | ----------------- |
| Root directory (Advanced settings) | `backend`         |
| Build command                      | `pnpm install`    |
| Deploy command                     | `pnpm run deploy` |

Root directory matters: `wrangler.jsonc` lives here, not at the repository
root, and wrangler resolves it relative to the working directory.

There is no `[env.production]` block — one worker, one set of `vars`. A second
environment would need every binding redeclared (Cloudflare environments do not
inherit) and would collide with this one on both name and route.

## Limits

`/submit` is public, so every field a node sends is attacker-controlled and
every unbounded structure is a denial-of-service vector. The Durable Object
memory ceiling is the limit Cloudflare does not publish, which is what most of
these protect.

### Connection limits

| Limit                                | Where                    | Close code |
| ------------------------------------ | ------------------------ | ---------- |
| 20 node ids per connection           | `GatewayDO`              | 4001       |
| 256 KB/s per connection (10s window) | `GatewayDO`              | 4002       |
| Genesis allowlist                    | `GatewayDO`              | 4003       |
| 20 upgrades/min per IP (`/submit`)   | edge rate limiter `6001` | HTTP 429   |
| 60 upgrades/min per IP (`/feed`)     | edge rate limiter `6002` | HTTP 429   |

Rate limiters throttle connection churn only — frames on an established socket
are not requests, which is what the byte budget covers. They fail open: a
limiter outage must not take ingest down.

### Input validation

Bounds live in `src/protocol/limits.ts`; a value outside them fails the whole
message rather than being clamped, since it did not come from a real node.

| Field                     | Rule                         |
| ------------------------- | ---------------------------- |
| Block heights             | Non-negative safe integers   |
| `notify.finalized` height | Plain decimal strings only   |
| Counts (peers, txcount…)  | Non-negative and finite      |
| Free-form strings         | ≤ 256 chars; addresses ≤ 128 |

This closed a confirmed exploit: before it, a single node reporting
`height: 1e308` became the chain's best block permanently, starving every
honest node of propagation numbers and rendering `1e+308` to every visitor.

### Chain directory TTL

`GET /chains` only lists chains active in the last 10 minutes, and expired
rows are deleted on read. Without it the picker accumulates a dead entry for
every chain the worker ever saw — one per throwaway devnet on a developer's
machine, each looking as current as the chain they are actually working on.
