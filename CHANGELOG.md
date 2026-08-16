# Changelog

All notable changes to Orbinum Telemetry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version lives in the root `package.json` only. A release is the service as
a whole: the worker and the UI compile the same wire contract from
[`shared/`](shared) and are deployed together, so "backend 2.1 with frontend
1.4" is not a combination that can exist.

## [Unreleased]

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

[Unreleased]: https://github.com/orbinum/telemetry/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/orbinum/telemetry/releases/tag/v0.1.0
