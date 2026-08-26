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

| Route                       | Purpose                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /submit`, `/submit/`   | Node telemetry WebSocket upgrade (both spellings — the chainspec multiaddr resolves with a trailing slash) |
| `GET /feed/:genesisHash`    | Browser feed WebSocket, routed straight to that chain's `ChainDO`                                          |
| `GET /chains`               | Chain directory for the UI's picker (CORS-enabled)                                                         |
| `GET /history/:genesisHash` | Chain history from D1: `?window=1h…30d`. Never touches a Durable Object                                    |
| `GET /uptime/:genesisHash`  | Per-node uptime and session counts; `?node=<PeerId>` for one node's sessions                               |

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

| Directory              | Holds                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| `protocol/`            | Parser for the node wire format. Pure; one file per message variant |
| `domain/`              | Node and chain state, propagation, bounded series. Pure, no I/O     |
| `gateway/`             | Node sockets, ingest policy, batching, chain directory access       |
| `chain/`               | Per-chain state owner, feed batching and fanout                     |
| `feed/`                | Domain → wire serialization for browsers                            |
| `ports/`               | What the code needs from its host, as interfaces                    |
| `adapters/cloudflare/` | The only place that names Cloudflare — the DO shells included       |
| `db/`                  | The history and session SQL — the only place that writes statements |
| `routes/`              | HTTP handlers; they route and validate, never parse telemetry       |
| `middleware/`          | CORS                                                                |
| `config/`              | Allowlist, limits and retention                                     |

`tests/` mirrors `src/`, plus `tests/security/` for adversarial input. 371
tests total; run them with `pnpm test`.

### Ports and adapters

The platform is reachable through one directory. `ports/` names what this
service needs from wherever it runs — a clock, deferred work, one alarm, two
repositories, a chain directory, sockets, how a chain is reached, and what the
edge provides — and `adapters/cloudflare/` is the only implementation.

That boundary is checked rather than asserted: `pnpm typecheck` also compiles
`ports/` under `tsconfig.ports.json`, which supplies no ambient types at all,
so an import that reaches a Cloudflare type fails the build.

`ChainDO` and `GatewayDO` are shells. They build the Cloudflare-shaped pieces
and forward to a `ChainService` and a `GatewayService` that name no platform
type — which is what lets the reaper's ordering and the gateway's socket
lifecycle be tested without a Durable Object to construct.

One thing no interface can enforce is written down in `ports/transport.ts`: an
adapter must not deliver a frame for a socket while that socket's previous
frame is still being handled. Cloudflare provides it by awaiting the handler,
which is why the promise chain that used to enforce it by hand could be
deleted; a host whose socket library does not await has to put it back.

## History

Live state is never persisted — a node rebuilds it from the wire within
seconds of reconnecting, so storing it would only add a second, always-stale
copy. What no restart can rebuild is **time**, and that is what D1 holds:

| Table                  | Written by                    | Kept     |
| ---------------------- | ----------------------------- | -------- |
| `chain_history`        | the chain's reaper, every 60s | 30 days  |
| `chain_history_hourly` | the nightly cron rollup       | forever  |
| `node_sessions`        | one row per connection        | one year |

The aggregation happens in `ChainState.snapshot()` **before** the write, which
is what makes the cost independent of node count: 5 nodes and 500 produce one
row a minute either way, and the version/implementation/country histograms
carry the per-node detail that a row-per-node would have cost 65× more to
store. Writes are deferred rather than awaited — history is best-effort, live
telemetry is not, so an overloaded D1 can never delay the reaper or the feed.

`node_sessions` answers what the per-chain histograms deliberately cannot:
which validator has the worst uptime, and which node keeps reconnecting. It is
written when a node arrives and closed when it leaves, so the volume follows
connection churn rather than message rate — a stable 500-node network writes
hundreds of rows a day, not hundreds of thousands.

It is keyed on the node's PeerId, the only identifier that survives a restart.
That is **self-reported**, so read the numbers as what nodes claimed; the API
labels them `identity: "self-reported"` for the same reason. Sessions from a
node that regenerates its key on every restart — one short session under an
identity never seen again — are pruned as the noise they are, while a node that
reconnects repeatedly is kept, because that is the signal.

Set up a fresh database with:

```sh
wrangler d1 create orbinum-telemetry     # paste the id into wrangler.jsonc
pnpm exec wrangler d1 migrations apply orbinum-telemetry --remote
```

The `DB` binding is optional in code: without it the worker runs exactly as
before and simply records nothing.

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

**The allowlist is fail-closed: a chain that is not listed is rejected, and
leaving all three empty serves nobody.** `GatewayService` logs an error at startup
in that case. There is no accept-everything mode — it would be one stray var
away from letting any chain on the internet spawn a Durable Object here.

To watch your own node, put its genesis hash in `TELEMETRY_CHAINS` in
`.dev.vars` and run `pnpm dev`. A `--dev` chain mints a fresh genesis whenever
you wipe it, so that hash changes and the worker needs a restart; a persistent
local chain avoids the churn.

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
| 20 node ids per connection           | `GatewayService`         | 4001       |
| 256 KB/s per connection (10s window) | `GatewayService`         | 4002       |
| Genesis allowlist                    | `GatewayService`         | 4003       |
| 20 upgrades/min per IP (`/submit`)   | edge rate limiter `6001` | HTTP 429   |
| 60 upgrades/min per IP (`/feed`)     | edge rate limiter `6002` | HTTP 429   |

Rate limiters throttle connection churn only — frames on an established socket
are not requests, which is what the byte budget covers. They fail open: a
limiter outage must not take ingest down.

### Input validation

Bounds live in `src/protocol/limits.ts`; a value outside them fails the whole
message rather than being clamped, since it did not come from a real node.

| Field                     | Rule                           |
| ------------------------- | ------------------------------ |
| Block heights             | Non-negative safe integers     |
| `notify.finalized` height | Plain decimal strings only     |
| Counts (peers, txcount…)  | Non-negative and finite        |
| Free-form strings         | ≤ 256 chars; addresses ≤ 128   |
| `network_id`              | base58, 46–64 chars (a PeerId) |

This closed a confirmed exploit: before it, a single node reporting
`height: 1e308` became the chain's best block permanently, starving every
honest node of propagation numbers and rendering `1e+308` to every visitor.

`network_id` is checked as a shape rather than only a length because it is the
node's identity: bounded at 128 free characters, one client could mint
unlimited distinct identities, which is a write amplifier against anything
keyed on it. The check is not anchored to the `12D3KooW` prefix — every
Orbinum node has an Ed25519 key today, but a node with any other key type
reports a differently shaped id and must not be dropped.

It stays **self-reported**: `/submit` is public and nothing proves the sender
holds the matching private key. It identifies a node exactly as well as the
node is honest.

### Chain directory TTL

`GET /chains` only lists chains active in the last 10 minutes, and expired
rows are deleted on read. Without it the picker accumulates a dead entry for
every chain the worker ever saw — one per throwaway local chain on a
developer's machine, each looking as current as the one they are actually
working on.
