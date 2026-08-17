# Changelog

All notable changes to Orbinum Telemetry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version lives in the root `package.json` only. A release is the service as
a whole: the worker and the UI compile the same wire contract from
[`shared/`](shared) and are deployed together, so "backend 2.1 with frontend
1.4" is not a combination that can exist.

## [Unreleased]

### Added

- **The network now has a past.** Everything the service knew lived in memory
  and died with its Durable Object: how many nodes were online last night, when
  finality stalled, whether a release reached every validator. None of it was
  reconstructible from any source. A `chain_history` table in D1 now holds one
  aggregated row per chain per minute — node count, authorities, stale nodes,
  best and finalized height, the finality lag between them, average block time,
  and histograms of version, implementation and country.

  Aggregating in memory before the write is the whole design: 5 nodes and 500
  produce the same single row per minute, where a row per node would have cost
  65× more for data the histograms already answer. The rows are written by the
  reaper alarm that already ran at exactly this cadence, through
  `ctx.waitUntil` — history is best-effort and live telemetry is not, so an
  overloaded database can never delay the node list.

- **`GET /history/:genesisHash`** serves that history straight from D1 without
  waking any Durable Object, so opening a chart never competes with ingest. A
  nightly cron rolls the 60s buckets into hourly ones and prunes what is past
  the retention window.

## [0.2.5] - 2026-08-16

### Fixed

- **Every validator was listed as a full node.** A node announces its role on
  connect as `authority: true`; the _address_ behind that role arrives
  separately via `afg.authority_set`, which clients only emit at telemetry
  verbosity 1 and above. Both the parser and the UI keyed off the address, so
  on a verbosity-0 network — which is the documented default, and what every
  Orbinum node runs — no node ever looked like a validator. The role is now
  read from the flag, and the Validator column says "validator" for an
  authority whose address has not arrived instead of showing a dash.

  This diverges from the reference implementation on purpose: it ignores
  `authority` and derives the role from the address alone, which is correct
  for Polkadot and Kusama because they report at verbosity 1 or above. Raising
  the nodes to verbosity 1 would surface the addresses too, at the cost of
  per-block chatter — the flag answers "how many validators are up" without
  it.

## [0.2.4] - 2026-08-16

**Every node reporting is a node shown.** Six nodes were connected and sending
data; the dashboard listed four of them, and which four changed between
reloads.

### Fixed

- **Nodes were overwriting each other, so the chain showed four of six.** A
  connection's id was a counter private to its GatewayDO, and node keys built
  from it (`1:1`) travel to a ChainDO that pools all four gateway partitions
  into one table. Every partition starts counting at 1, so the first socket on
  one partition and the first on another claimed the same key, and the later
  arrival silently replaced the earlier. The symptom read as a node-side
  problem — the visible set shifted between reloads, and correcting one node's
  configuration made a different node disappear — which is what makes it worth
  naming: every node was connected and reporting the whole time. Connection
  ids now carry the Durable Object's own id, unique per partition.
- `Tab.tsx` exported a helper alongside its components, which costs the file
  its Fast Refresh. Nothing imported it; it is local now.

## [0.2.3] - 2026-08-16

**The UI on a phone.** The node table assumed a desktop viewport, and both of
the page's waits were rendered as emptiness — two ways of showing something
untrue to whoever opened it on the smaller screen.

### Added

- **Loading states while the page has no answer yet.** The chain directory and
  the feed socket both take a moment, and until now the page filled that gap
  with its empty state — "No nodes reporting yet" was shown before anyone had
  asked. The two waits now say so, and the empty state means what it says.
  Switching networks keeps the current list on screen instead of flashing a
  spinner over it.

### Fixed

- **The node table was unusable on a phone.** Twelve columns held a
  `min-width` of 72rem, so a narrow screen got one long sideways scroll where
  every row opened with the same two fields. The table now drops to three
  columns below 64rem — name, best block, last block, which is what "is my
  node keeping up" actually needs — and to six between 64 and 80rem. The list
  height also stopped assuming desktop chrome: the stat cards wrap to two rows
  below 40rem, making the header taller exactly where the viewport is
  shortest, so the space reserved for it is now a variable rather than a fixed
  22rem.

## [0.2.2] - 2026-08-16

### Fixed

- **The deploy step never ran a deploy.** `pnpm -C backend deploy` resolves to
  pnpm's own `deploy` command — which publishes a workspace and knows nothing
  about the script of the same name — so the job died on
  `ERR_PNPM_CANNOT_DEPLOY` before wrangler was ever invoked. Both root scripts
  now say `run deploy` explicitly. 0.2.1 tagged and published without
  deploying; this release carries it to Cloudflare.

## [0.2.1] - 2026-08-16

**The release pipeline reaches Cloudflare.** 0.2.0 tagged and published but
stopped there — deploying was still a manual step, so the fail-closed
allowlist it shipped never reached production. This release carries it there.

### Added

- **A release deploys itself.** Once the tag and the GitHub Release exist, CI
  publishes the worker and then the UI. The worker goes first: it owns the
  wire contract the UI compiles against, so a UI ahead of its worker is the
  ordering that breaks. Needs `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` in the `production` environment, and both Cloudflare
  projects disconnected from the repository — their own Git integrations built
  on every push to `main`, ahead of CI and racing this deploy.

### Fixed

- **A push to `main` cancelled the CI run its own release was waiting on.**
  Both fire on the same commit and the same ref, and the concurrency group
  meant to separate them keyed on `github.event_name` — which a called
  workflow inherits from its caller, so it read `push` in both cases and put
  them in one group. The release gate then reported the cancelled run as
  "Backend checks failed", pointing at a package that was never the problem.
  The group now keys on `github.workflow`, and `all-checks` names a cancelled
  or skipped job for what it is instead of calling it a failure.

### Security

- **A pull request's branch name could run commands on the CI runner.** The
  `protect-main` job interpolated `github.head_ref` straight into a shell
  script, and the person opening the PR chooses that name. It now travels
  through an environment variable, where the shell never parses it.

## [0.2.0] - 2026-08-16

**Devnet is gone, and the genesis allowlist no longer has an open mode.**

The worker decided which nodes to accept by matching their genesis hash
against an allowlist — except that an _empty_ allowlist accepted everything,
which is what made local development against a `--dev` chain possible. That
default meant one missing or mistyped variable stood between the deployed
worker and accepting every chain on the internet, each one spawning a Durable
Object. The convenience and the vector were the same line of code, so both are
removed.

### Removed

- **Devnet, entirely.** The UI no longer carries a Devnet network, and the
  worker no longer has a mode that accepts it. A `--dev` chain mints a fresh
  genesis on every restart, so it could never be allowlisted; the previous
  arrangement leaned on "empty allowlist means accept everything", which put
  the deployed worker one missing or mistyped variable away from accepting
  every chain on the internet. A developer who wants to watch their own node
  runs their own worker with that chain's genesis in `TELEMETRY_CHAINS`, and
  points the UI at it with `VITE_API_BASE`.

### Changed

- **The genesis allowlist is fail-closed.** A chain that is not listed is
  rejected, and an empty allowlist now serves nobody instead of serving
  everybody; `GatewayDO` logs an error at startup when it ends up empty. A
  misconfigured deployment is loudly useless rather than quietly open.
- A stored `devnet` choice from an earlier visit falls back to an available
  network instead of stranding the user on one that no longer exists.

## [0.1.0] - 2026-08-14

**Orbinum's own telemetry, instead of a shared tenancy on telemetry.polkadot.io.**

Node visibility lived on third-party infrastructure, mixed with hundreds of
other chains and impossible to shape around what Orbinum needs to show. This
is the same function, self-hosted: a live node list with block height,
finalized blocks, peers, transactions in the pool, propagation time, version
and approximate location.

One deploy serves testnet and mainnet — the chain is a filter in the UI, not a
second stack to operate.

### Added

- **Node ingest** at `wss://telemetry.orbinum.io/submit/`. Speaks the fixed
  Substrate telemetry protocol: all six `msg` variants, both envelope versions,
  hashes as hex or as a 32-byte array, and the legacy
  `$version-$commit-$arch-$os-$env` split.

  The protocol's real asymmetry is honoured — `block.import` sends `height` as
  a JSON number while `notify.finalized` sends it as a string. Getting that
  wrong produces a plausible but incorrect UI rather than an error, so each
  shape has its own parser and its own tests.

- **Chain aggregation** ported from the reference's Rust: best and finalized
  tracking, average block time, propagation (the first node to report a height
  gets `0`, everyone after it gets the delay against that first report), and a
  2-minute stale sweep that recomputes the tip from live nodes so one dead node
  cannot freeze the chain's reported height forever.

- **Browser feed** at `/feed/:genesisHash`, on hibernatable sockets. Plain JSON
  with named keys rather than the reference's positional opcodes: both sides
  are ours, and permessage-deflate absorbs the difference. The initial snapshot
  is chunked at 100 nodes per frame and deltas are batched every 100 ms.

- **UI** with the twelve v1 columns, live search by name or validator address,
  click-to-sort columns persisted across reloads, a stats view of live
  histograms, and light/dark theming shared with the rest of the workspace.

  The socket lives outside React and flushes once per animation frame, and
  rows subscribe per node id. With `@tanstack/react-virtual` the DOM holds
  ~29 rows whether the chain has 50 nodes or 500 — measured at 60 fps under
  synthetic load.

- **Chain directory** at `GET /chains`, backed by SQLite in each gateway
  partition, so the chain picker is populated even right after a deploy when
  every Durable Object's memory is empty.

### Security

- **Genesis allowlist.** A public `/submit` would otherwise accept nodes from
  any chain, and each one would spawn a Durable Object that consumes memory
  forever. Configured per environment via `TELEMETRY_TESTNET_GENESIS` /
  `TELEMETRY_MAINNET_GENESIS`; the gateway warns loudly at startup when it ends
  up empty.

- **Per-connection limits**: 20 node ids per socket and a 256 KB/s budget over
  a 10-second sliding window. Frames on an established socket never reach an
  edge rate limiter, so the byte budget is the only defence against a client
  that floods a connection it already opened.

- **Edge rate limiting** on both upgrade paths, keyed by `CF-Connecting-IP`,
  which is authoritative at the edge and cannot be forged. They fail open: a
  limiter outage must not take ingest down.

- **Bounds on every untrusted value.** Block heights must be non-negative safe
  integers, finalized heights must be plain decimal strings, counts must be
  non-negative, and free-form strings are capped. This closed a confirmed
  exploit: before it, a single node reporting `height: 1e308` became the
  chain's best block permanently, starving every honest node of propagation
  numbers and rendering `1e+308` to every visitor.

### Notes

- Genesis hashes are configuration, never constants in code. Testnet's has
  already changed once — the value in `node-deploy/docs/TOPOLOGY.md` is stale.
  Read the current one from a live node with `chain_getBlockHash(0)`.

- Substrate's client sends **binary** WebSocket frames, which arrive as `Blob`
  in workerd and need an async read. A text-only handler completes the upgrade
  and then silently receives nothing — the node reconnects forever and the only
  symptom is an empty list.

[Unreleased]: https://github.com/orbinum/telemetry/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/orbinum/telemetry/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/orbinum/telemetry/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/orbinum/telemetry/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/orbinum/telemetry/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/orbinum/telemetry/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/orbinum/telemetry/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/orbinum/telemetry/releases/tag/v0.1.0
