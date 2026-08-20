# Changelog

All notable changes to Orbinum Telemetry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version lives in the root `package.json` only. A release is the service as
a whole: the worker and the UI compile the same wire contract from
[`shared/`](shared) and are deployed together, so "backend 2.1 with frontend
1.4" is not a combination that can exist.

## [Unreleased]

## [0.4.0] - 2026-08-20

**The dashboard shows what it already knew.** Three things the service had been
collecting since early releases — a node's coordinates, its role, and the
chain's own past — reached the screen for the first time. None of them needed
new data: the coordinates had ridden the feed since day one with no frontend
reading them, the role was on the wire and rendered ambiguously, and the
history had been accumulating in D1 behind an endpoint nobody called.

### Changed

- **The validator column was two columns wearing one hat.** It rendered the
  SS58 address when there was one, the literal word `validator` when there was
  not, and a dash otherwise — so a single cell answered both "what is this
  node" and "which account is behind it". Sorting it sorted by address alone,
  which buried authorities without one at the bottom of the list under a header
  that said Validator, and filtering could never match the word `rpc` at all,
  since the query only ever saw addresses.

  It is now **Type** (`validator` or `rpc`) and **Address** (the SS58 string).
  Each sorts and filters by what it actually shows, and typing `rpc` or
  `validator` into the filter finally does the obvious thing.

  The role comes from the node's own `authority` flag, never from its name:
  Orbinum's validators run with `--rpc-port` as well, so a node that serves RPC
  and authors blocks is a validator, and the flag is the half the node actually
  reports.

### Added

- **A map of where the nodes are.** The Location column and its histogram both
  answer "which countries", and neither can show what an operator actually
  wants to know: how concentrated the network is. A new Map tab plots one
  marker per location, its area scaled to the node count, so eight nodes in one
  datacenter read differently from eight cities running one each — and the
  gaps, whole continents with nothing on them, read at a glance.

  The coordinates were already arriving. Cloudflare attaches them to every
  upgrade request and they have ridden the feed since the first release; no
  frontend code had ever read them, so this needed no backend change at all.
  Markers are coloured by role and carry the count where it fits; hovering one
  names the place. Nodes whose coordinates Cloudflare omitted are excluded
  rather than parked at (0, 0) — which is in the Atlantic, and would read as a
  real cluster — and the panel says how many were left out.

  MapLibre over CARTO's basemap, loaded lazily: the main bundle is unchanged,
  and the map's weight is paid only by whoever opens the tab. This is the one
  view that talks to a third party, so the tile host sees the IP of anyone who
  opens it — nothing about a node is sent, but the request happens. Swapping in
  a self-hosted basemap later is a one-line change.

- **The validator address survives losing the memory that held it.** It arrives
  in exactly one message, `afg.authority_set`, sent milliseconds after a node
  connects and never sent again. Anything that cleared in-memory state — a
  ChainDO eviction, a gateway redeploy, the node restarting — dropped it for
  good, because the eviction path could only replay the cached
  `system.connected`, which does not carry it. The address would appear, then
  silently vanish hours later with nothing to explain it.

  A `validator` column on `node_sessions` (migration `0003`) now records it as
  it arrives, and a reconnecting node is seeded from the last session that had
  one. Both writes go through `ctx.waitUntil` like the session rows beside
  them: a slow D1 costs a column in the UI, never the live feed. The lookup
  only fills a gap and re-checks after reading, so a stored address can never
  overwrite one the node just reported.

  This also covers the case the migration was not written for: a validator
  reporting at telemetry verbosity 0 never sends `afg.authority_set` at all, so
  its address would otherwise stay blank forever. Once that PeerId has reported
  one, it keeps showing.

### Fixed

- **Wide history windows answered with nothing for any chain younger than a
  month.** `GET /history?window=7d` and `30d` read the hourly rollup, and an
  hour only reaches that table once it falls out of the raw 60s buckets — 30
  days later. So a chain three days old returned zero points, which reads as
  "this chain has no history" rather than "this chain is three days old". Not
  an edge case: it is the normal state for the whole first month of any chain's
  life, mainnet included at launch, and exactly when the history is most looked
  at.

  Both windows now read the rollup *and* the raw buckets, folding the raw half
  into the same hour groups the rollup uses so a point does not shift the day
  its hour is finally rolled up. Against production's three days of data the
  two windows went from 0 points to 74. The response also gained a `covers`
  field naming the range actually returned, so a chart can label its axis with
  what exists instead of implying a month that was never recorded.

- **MapLibre rendered nothing under `vite dev`, silently.** It decodes vector
  tiles in a Web Worker loaded from its own bundle; Vite's dependency
  pre-bundling rewrote that path, the worker 404'd, and a map that cannot
  decode tiles never requests any — so the basemap was blank with no error
  anywhere, because the failure happened inside a worker nobody was listening
  to. `optimizeDeps.exclude` fixes it. Production builds were never affected,
  which is what made it look like a rendering bug rather than a dev-server one.

- **`sysinfo.hwbench` is unreachable, and now it is written down.** The parser
  and the domain state for hardware benchmark scores have been complete since
  Phase 2, and nothing has ever sent one: the node binary rejects
  `--enable-hardware-benchmarks` outright and never emits the message, because
  nothing in its code wires up `sc-sysinfo`. That is a change in the node repo,
  not here and not in `node-deploy` — adding the flag to a compose file would
  stop validators from starting, since the binary rejects the argument. The
  parser stays as it is: it costs nothing and is ready for the day a node
  sends one.

- **Validator addresses were missing in production, and the code was not at
  fault.** `afg.authority_set` is only emitted at telemetry verbosity 1 and
  above, and every Orbinum node reported at `0`, so the address never arrived
  to be shown. The fix is in `node-deploy`, where validators now report at `1`;
  RPC nodes stay at `0`, having no address to send and no reason to pay for the
  per-block chatter the higher level adds.

## [0.3.1] - 2026-08-18

### Changed

- **The filter row said the same thing twice, in two places.** The count of
  hidden nodes was rendered both by the page, next to the node count, and by
  the search box itself — absolutely positioned below the input, where it
  escaped the row's box and overlapped the table header beneath it. The count
  now lives only where it belongs, beside the number it qualifies, and reads
  as one sentence: `11 nodes · 7 hidden by filter`. That second half is a
  button now, so the way out of a filter that hides most of the list is where
  the user is already looking, not only in the input's clear icon.

  The input picks up the affordances it was missing — a fixed height so it
  aligns with the count instead of sitting a few pixels off, a rounded border
  matching the cards around it, a hover state, and a focus ring on the accent
  colour rather than the muted one. Below `sm` the row stacks: the input takes
  the full width and the count moves under it.

- **The node list shows every node.** The list rendered into its own scroll
  area, capped at the viewport minus a hardcoded 22rem of chrome, with rows
  virtualized inside it. On a chain with 100 validators that meant roughly
  fifteen rows visible and the other eighty-five behind an inner scrollbar the
  page gave no hint of — and the cap was a guess about layout that a stat-card
  wrap or a longer title silently invalidated. Rows now render in full and the
  page itself scrolls, so the row count is the node count.

  Virtualization bought a constant-size DOM for lists in the thousands, which
  is not the shape of an Orbinum chain; dropping it removes
  `@tanstack/react-virtual`, the absolute row positioning, and the fixed row
  height that had to be kept in sync between the CSS and the component. The
  header still sticks — to the viewport now rather than to the inner
  container.

## [0.3.0] - 2026-08-17

**The service remembers.** Every number it knew was live and only live: the
dashboard could say fourteen nodes are up, never that nine were up at 3am, and
a Durable Object restart erased even that. This release keeps the part of
telemetry that cannot be rebuilt from the wire — time — in D1.

Nothing about ingest or the live feed changes. The `DB` binding is optional in
code, so a deploy without it behaves exactly as 0.2.5 did.

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

- **A node now has an identity that survives its restart.** Nothing in the
  service did: the feed's numeric id is a counter that resets with the Durable
  Object, and the internal key is built from socket ordering, so the same
  machine reconnecting was indistinguishable from a new one. The libp2p PeerId
  is the one field that holds — every Orbinum node pins its key in `.env` —
  and it now reaches the UI, where a row's tooltip shows it.

  Verified rather than assumed: a real node restarted twice with a persistent
  base path reported one PeerId across all three runs.

- **Per-node uptime**, at `GET /uptime/:genesisHash`. The per-chain histograms
  collapse node identity on purpose, so they cannot say which validator drops
  most often or which node keeps reconnecting; a `node_sessions` table now
  records one row per connection — opened when a node arrives, closed when it
  leaves — and those two questions become a query. `?node=<PeerId>` returns one
  node's sessions, where many over a short window is a flapping node.

  One row per connection rather than per interval is what makes it affordable:
  a stable 500-node network writes hundreds of rows a day instead of hundreds
  of thousands, and a whole sweep closes in a single batched statement rather
  than one call per node.

  A node with no persistent volume regenerates its key on every restart and so
  appears as a fresh identity that connects once and is never seen again. Those
  are pruned as noise; a node that reconnects repeatedly is kept, because that
  is the signal. The uptime numbers are labelled `identity: "self-reported"` —
  a figure called "uptime" reads as authoritative otherwise.

### Changed

- **`network_id` is validated as a PeerId, not merely bounded in length.** It
  is the identity anything per-node will be filed under, and a free
  128-character string let a single client mint unlimited distinct identities —
  unbounded cardinality against a keyed table, which is a write amplifier
  rather than a display bug. The check covers the base58 alphabet and the
  length, and deliberately not the `12D3KooW` prefix: every Orbinum node uses
  an Ed25519 key today, but anchoring on that would silently drop a node using
  any other key type.

  It stays **self-reported and unverified** — `/submit` is public and nothing
  proves the sender holds the matching key. The parser checks the shape, never
  the ownership.

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

[Unreleased]: https://github.com/orbinum/telemetry/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/orbinum/telemetry/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/orbinum/telemetry/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/orbinum/telemetry/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/orbinum/telemetry/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/orbinum/telemetry/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/orbinum/telemetry/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/orbinum/telemetry/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/orbinum/telemetry/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/orbinum/telemetry/releases/tag/v0.1.0
