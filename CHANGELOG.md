# Changelog

All notable changes to Orbinum Telemetry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version lives in the root `package.json` only. A release is the service as
a whole: the worker and the UI compile the same wire contract from
[`shared/`](shared) and are deployed together, so "backend 2.1 with frontend
1.4" is not a combination that can exist.

## [Unreleased]

### Fixed

- **Ingest paid a full billed request per node frame.** The gateway called
  `nodeMessage` on a ChainDO once for every frame a node sent. Each RPC call is
  billed as its own request, and unlike the WebSocket frames feeding them it
  gets no 20:1 discount — so the hop between the two objects cost roughly
  twenty times the sockets carrying the same traffic. At 500 nodes that is
  ~1.000 RPCs/s into a single object.

  Frames now accumulate per chain for 100 ms and travel in one `nodeMessages`
  call, which collapses a chain's ingest to ~10 calls/s. The window matches the
  feed's own flush interval, so nothing downstream can observe the delay.

  `nodeMessages` returns the node keys the chain did not recognize rather than
  a single flag. That keeps the eviction recovery per node: a ChainDO that was
  evicted while the gateway held the socket forgets some nodes and not others,
  and one forgotten node must not force a whole chain's batch to be replayed.

  Batching lives in its own `IngestBatcher` rather than inside `MessageRouter`.
  The router decides whether a message may be routed and where; the batcher
  decides when it travels and how a failed delivery is retried. Keeping a timer
  and a recovery loop out of the class that holds the ingest policy is what
  lets both be tested without a WebSocket.

- **The four gateway objects were billed around the clock.** `GatewayDO`
  accepted node sockets with a plain `accept()`, which bills wall-clock
  duration for as long as the socket is open — and node sockets are open
  permanently. Four partitions therefore ran up duration charges 24/7 whether
  or not a frame ever arrived. `ChainDO` had used the hibernation API for
  browser feeds since Phase 4; the ingest half never got the same treatment.

  Node sockets are now accepted with `ctx.acceptWebSocket()`, so a partition is
  billed only while it is actually handling a frame.

  That moves per-socket state out of the object, since hibernation evicts it
  while the socket lives on. The byte budget, the geo and the cached
  `system.connected` now ride the socket's attachment. The budget mattered
  most: had it stayed in memory, a client could have reset its own rate limit
  for free by making the object drop.

  Two things fell out of the change. The hand-rolled promise chain that kept a
  connection's frames in order is gone — the runtime already delivers one
  socket's messages one at a time. And the connection-id counter now resumes
  past the highest id still connected: restarting at 1 after an eviction would
  have handed a new socket the id of one still streaming, and since both build
  the same node keys, the older node would have been silently replaced.

- **A brief outage made every open tab reconnect in lockstep.** The feed client
  retried on a fixed 2 s delay with no jitter and no ceiling, so the moment a
  chain's Durable Object blipped, every browser watching it came back at the
  same instant — and kept doing so, twice a minute each, for as long as the
  outage lasted. Every attempt costs a billed request plus a full init snapshot,
  which at 500 nodes is ~338 kB, so the retries were most expensive exactly when
  the object could least afford them.

  Reconnects now back off exponentially from 2 s to 30 s with ±25% jitter. The
  jitter is the half that breaks the herd: without it clients stay
  synchronized, only slower.

  The backoff resets on the first `init` frame rather than on `onopen`. A
  Durable Object that accepts a socket and then dies still fires `onopen`, so
  resetting there would pin the delay at 2 s through precisely the outage the
  backoff exists for. An `init` proves the object is actually serving.

## [0.6.0] - 2026-08-21

### Added

- **Node hardware reaches the browser.** The backend had parsed, validated and
  held sysinfo, hwbench and the bandwidth series since Phase 2 — the plan said
  to capture them from day one and render them later — but `toFeedNode` never
  emitted any of it, so ten columns and fourteen of fifteen chain statistics had
  no data to draw from. The feed now carries the target triple, sysinfo (CPU,
  memory, cores, kernel, distro, VM flag) and the five benchmark scores.

  Measuring first changed the design. At 500 nodes a delta frame weighed 338 kB;
  adding everything naively took it to 1213 kB, every 100 ms. The four chart
  series were most of that, and they are 20-point moving averages, so refreshing
  them ten times a second buys nothing a sparkline could show.

  So the feed now has three cadences instead of one. The snapshot carries
  everything. The 100 ms delta carries only what changed — the target triple and
  sysinfo are fixed for a session and ride the frame that introduces a node,
  never the ones after it. The series move to their own message on a 5 s tick.
  `hwbench` counts as session-fixed too even though it lands after connect: the
  Durable Object reintroduces the node when it arrives, so the next delta
  carries the full row rather than repeating five scores forever.

  The hot frame ends up at 338 kB — unchanged — with all of the new data
  available. Sustained, that is 3.4 MB/s against 11.8 MB/s had it all gone in
  the delta.

### Changed

- **`upd` frames merge instead of replacing.** A delta now omits what cannot
  have changed, so overwriting the row wholesale would blank the hardware fields
  that only ever ship once. An absent key means "unchanged", never "gone".

  `FEED_VERSION` rises to 2 for this. Every new field is optional, so on that
  count older clients would have coped — but the rule for reading `upd` itself
  changed, which is exactly the condition the version was added to catch.

## [0.5.0] - 2026-08-21

### Fixed

- **Every relative timestamp was off by the viewer's clock error.** "Last
  block: 4s" was `Date.now()` in the browser minus a timestamp stamped by the
  server — two different clocks. A machine running a minute fast reported every
  node as having produced its last block a minute earlier than it did, silently,
  with nothing on screen to suggest the number was wrong.

  The `init` frame now carries the server's clock, the client measures the
  difference once per connection, and `useTick` returns corrected time. It is
  the only place in the frontend that reads a wall clock, so every relative
  label is right by construction and a new one cannot forget to adjust. The
  offset is remeasured on each reconnect, which is what re-syncs a laptop that
  resumed from sleep with a drifted clock.

- **A node going stale could stay invisible.** The flag is computed deep in the
  block-handling path, but the feed only ships what the hub was told is dirty,
  and nothing marked those nodes. The amber "no recent block" dot appeared only
  when some unrelated event happened to mark the same node dirty — the one
  indicator that cannot tolerate arbitrary latency.

  The chain now collects the ids whose flag flipped and the Durable Object
  drains them into the hub. Only transitions are collected: a node already known
  to be stale would otherwise be rebroadcast on every sweep, turning a quiet
  chain into a stream of no-op frames.

  Two things surfaced while building it. The sweep runs *before* the incoming
  block is applied — matching the reference — and `updateBlock` clears the flag,
  so the very node carrying the block is marked stale a moment before being
  cleared again; those phantom transitions are filtered on the way out. And the
  sweep only ever ran from the block handler, which meant a chain that stopped
  producing blocks entirely never swept again and left every node marked live
  forever. The reaper alarm now sweeps too, which is the case where the
  indicator matters most.

- **A half-open socket showed frozen data as "live".** A connection dropped by
  an intermediary without a FIN never fires `close`, so the feed sat silent
  while the page kept claiming to be live. Silence is indistinguishable from a
  healthy chain with nothing new to report, which makes it the worst failure
  mode a telemetry dashboard can have.

  The client now pings every 30s and tears the socket down after two unanswered
  intervals, letting the existing reconnect take over. The server answers from
  the runtime's WebSocket auto-response, so a hibernating Durable Object stays
  hibernating — the whole scheme costs one frame each way per client per 30s and
  no wall-clock billing. Any incoming frame counts as proof of life, not just
  the pong: a busy chain may never leave a gap long enough for the timeout to
  notice.

### Added

- **The feed wire format is versioned.** A tab left open across a deploy that
  reshapes `FeedNode` had no way to tell it was reading frames it no longer
  understood; the fields it expected were simply absent and it rendered wrong
  data rather than failing. The `init` frame now carries `FEED_VERSION`, and a
  client that does not recognise it discards the frame, stops reconnecting and
  offers a reload.

  Reloading is left to the user on purpose: doing it automatically loops
  against a server that is mid-rollout between two versions. The number rises
  only when a field is removed or reinterpreted — adding an optional one does
  not count, since older clients ignore what they do not read, which is the
  reason the wire format uses named keys.

## [0.4.4] - 2026-08-21

### Fixed

- **Validators reported their address as the literal text `<unknown>`.** Nodes
  redeployed with telemetry verbosity 1 filled the Address column with that
  placeholder instead of an account. Substrate sends it when a node runs with
  `--validator` but cannot yet name its authority — no usable session key in
  the keystore, or a key not yet in the on-chain set. At verbosity 0 the field
  never arrives at all, so the string only became visible once the fleet
  started reporting at 1.

  It cost more than a wrong-looking cell. The address a node has already
  reported is never overwritten, which is what stops a stale row from clobbering
  live data — so a node holding `<unknown>` counted as "already has an address"
  and blocked the D1 lookup that would have restored the real one from an
  earlier session. The placeholder also reached `node_sessions`, where the most
  recent non-NULL row wins, hiding every real address recorded before it.

  Both parsers now reject it: `system.connected` drops the field and keeps the
  node, since the rest of the message is valid and the node must still appear;
  `afg.authority_set` is rejected whole, as the address is the only thing it
  carries. Migration `0004` clears the rows already written.

  The reference implementation does not filter this — it passes `validator` and
  `authority_id` through untouched and renders the address as a Polkadot
  identicon, where the placeholder fails to decode and merely logs. Orbinum
  shows the address as text and persists it, so the same input does real damage
  here and is worth rejecting at the boundary.

## [0.4.3] - 2026-08-20

### Added

- **The map says it is loading instead of showing an empty box.** Opening the
  Map tab fetches a 950 kB chunk and then a basemap from CARTO, and until both
  arrive the container was simply blank — indistinguishable from the failure
  fixed in `0.4.2`, where a blank map was exactly the symptom. On a slow
  connection the honest reading of that blank box was "this is broken again".

  A spinner now covers the container until MapLibre reports `load`, which is
  the event that means the style is parsed and the first tiles are in, rather
  than merely that the module arrived. It reuses the same `LoadingState` as the
  node list, so waiting looks the same everywhere in the app.

  The overlay sits on top of the map rather than replacing it: MapLibre
  measures the element it is handed, and a container that is unmounted while
  loading reports zero width and never requests a tile — the spinner would have
  caused the blankness it was added to explain. It also clears on the map's
  `error` event, since a style request that fails never fires `load` and would
  otherwise leave the spinner turning for good; the markers are drawn from our
  own data, so that case degrades to "no basemap" rather than "forever
  loading". The container carries `aria-busy` for the same state.

## [0.4.2] - 2026-08-20

### Fixed

- **The map showed an empty basemap in production, and the console error named
  the wrong culprit.** It reported a module served as `text/html`:

      /assets/maplibre-gl-worker.mjs
      Failed to load module script: The server responded with a non-JavaScript
      MIME type of "text/html".

  MapLibre decodes vector tiles in a Web Worker whose URL it resolves itself,
  against its own module URL. No import points at that file, so the bundler
  never emitted it, and the request reached `/assets/` with nothing behind it —
  which Pages answers with the SPA fallback, hence HTML where a module was
  expected. The same class of miss as the `0.4.1` fix, from the opposite
  direction: there an asset had been deleted, here it was never built.

  Pointing MapLibre's `WORKER_URL` at a real bundled asset fixes it. What that
  took was not the obvious import: `?url` emits only the file it names, and the
  worker is itself a module importing `./maplibre-gl-shared.mjs`, so it loaded,
  failed that import, and died. `?worker&url` bundles the dependency in, which
  is visible in the build — the emitted worker goes from 18 kB to 470 kB.

  Both failures are silent by construction, which is what made this worth
  chasing past the first green build: a map whose worker is gone stops
  requesting tiles rather than reporting anything, so the page looks like a
  styling bug. The fix is confirmed the only way it can be — in a browser, on
  the built output, by the tile requests appearing at all.

- **Every row in the node table was misaligned from its header below 80rem.**
  The responsive rules hide columns by `nth-child`, so they carry hard-coded
  positions into the column list, and splitting the validator column into Type
  and Address in `0.4.0` shifted every position after the third. The rules kept
  hiding the old ones.

  On a phone that meant the three columns worth keeping — name, best block,
  last block — were not the three that survived: it showed `Name`, `Txs`,
  `Finalized` and `Location` instead. Four cells, against a grid still
  declaring three columns, so the fourth wrapped onto a second line and every
  row drifted out of step with the header above it. The middle tier had the
  same fault, seven cells in six columns.

  The positions now match the columns they are named for, and a test reads the
  stylesheet and the column list together and fails when they disagree — the
  drift is the kind that survives review precisely because the CSS looks right
  in isolation.

  The tier boundary moved from 64rem down to 48rem while the rules were open:
  the seven-column layout fits comfortably at 768px, and a landscape tablet was
  being given the three-column phone layout for no reason. Column widths were
  retuned so nothing overflows at either end of that range, and so `Type` shows
  `validator` rather than `valida…`. The desktop layout still scrolls
  horizontally, which is the honest answer for thirteen columns.

## [0.4.1] - 2026-08-20

### Fixed

- **Opening the Map tab after a deploy showed the router's raw error screen.**
  The map is the one route loaded with a dynamic `import()`, and its chunk
  carries a content hash that changes on every build. A tab left open across a
  deploy still holds the previous `index.html`, so its next visit to the tab
  asked for a chunk that no longer exists. Pages answers anything it cannot
  find with the SPA fallback, so the request returned `index.html` with a 200,
  and the browser rejected the HTML it was handed in place of a module:

      Failed to load module script: Expected a JavaScript-or-Wasm module script
      but the server responded with a MIME type of "text/html".

  The MIME complaint reads like a server misconfiguration and is not one. The
  headers were correct throughout — `application/javascript` on `/assets/*`,
  `no-cache` on `index.html` — and every hashed asset that exists is still
  served correctly. The 200 is the fallback doing its job for an asset that
  was deleted by the very deploy the open tab had not yet seen.

  A failed chunk now reloads the page once, which fetches the current
  `index.html` and resolves the new hash. The reload is recorded in
  `sessionStorage`, so a failure that survives it is not staleness and is not
  reloaded again — that path renders a message instead of looping. The other
  cause of the same failure is an extension blocking the request
  (`net::ERR_BLOCKED_BY_CLIENT`), which no reload can fix, so the message names
  it: the fix belongs to the reader, not to the server.

  Only the lazy chunk is recoverable this way. If the main bundle is what gets
  blocked, no application code is running to notice.

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

[Unreleased]: https://github.com/orbinum/telemetry/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/orbinum/telemetry/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/orbinum/telemetry/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/orbinum/telemetry/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/orbinum/telemetry/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/orbinum/telemetry/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/orbinum/telemetry/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/orbinum/telemetry/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/orbinum/telemetry/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/orbinum/telemetry/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/orbinum/telemetry/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/orbinum/telemetry/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/orbinum/telemetry/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/orbinum/telemetry/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/orbinum/telemetry/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/orbinum/telemetry/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/orbinum/telemetry/releases/tag/v0.1.0
