# Orbinum Telemetry — UI

Live node list for `telemetry.orbinum.network`, on Cloudflare Pages.

```sh
pnpm dev              # vite on :5173
pnpm check            # lint + typecheck + fmt + build + test
pnpm deploy           # build + wrangler pages deploy
```

The UI needs a worker to read from. Start one with `pnpm -C ../backend dev`
and point a node at it:

```sh
orbinum-node --dev --tmp --name my-node \
  --telemetry-url "ws://127.0.0.1:8787/submit/ 1"
```

## Networks

The switcher offers Testnet and Mainnet, both served by the deployed worker.

A network only appears once its genesis hash is configured — an unconfigured
tab could only ever fail, since the worker rejects chains it does not know.

**There is no devnet tab.** A `--dev` chain gets a fresh genesis on every
restart, so it can never be in an allowlist, and the deployed worker rejects
it. To watch your own node, run your own worker with that chain's genesis in
`TELEMETRY_CHAINS` (see the [backend README](../backend/README.md)) and point
this UI at it with `VITE_API_BASE=http://localhost:8787`.

| Variable               | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `VITE_API_BASE`        | Telemetry worker. Defaults to `telemetry.orbinum.io` |
| `VITE_TESTNET_GENESIS` | Testnet genesis hash; the tab is hidden without it   |
| `VITE_MAINNET_GENESIS` | Mainnet genesis hash; fill in at launch              |

Set them in `.env.production` (committed) or `.env.local` (ignored). See
[`.env.example`](.env.example).

## Structure

| Directory       | Holds                                                           |
| --------------- | --------------------------------------------------------------- |
| `presentation/` | Components, pages, layouts, router. `components/ui/` is generic |
| `stores/`       | zustand state: feed, network, theme                             |
| `domain/`       | Pure logic — ordering, filtering, statistics. No React          |
| `services/`     | The feed WebSocket client and the chain directory fetch         |
| `config/`       | Which networks exist and which worker serves each               |
| `utils/`        | Formatting and typed localStorage access                        |
| `styles/`       | Design tokens shared with the rest of the workspace             |

`tests/` mirrors `src/`; 55 tests, run with `pnpm test`.

## Rendering at scale

A chain can report hundreds of nodes at roughly 1 Hz each, which is enough to
make a naive React app unusable. Three things keep it at 60 fps:

- **The socket lives outside React** ([`services/feed-client.ts`](src/services/feed-client.ts)).
  It writes into a plain `Map` and flushes once per animation frame, so a
  burst of messages becomes one commit rather than one per message.
- **Rows subscribe individually.** `useNode(id)` reads a single entry, so a
  delta for one node re-renders one row.
- **The table is virtualized** with `@tanstack/react-virtual`: the DOM holds
  ~29 rows whether the chain has 50 nodes or 500.

Filtering and sorting run on flush, never in render — see
[`domain/node-order.ts`](src/domain/node-order.ts).

The node table is a CSS grid rather than a `<table>`: virtualized rows are
absolutely positioned, which table layout cannot express. Row height is fixed
in `--node-row-height` and mirrored by `ROW_HEIGHT` in `NodeTable.tsx`; a
mismatch leaves the container scrollable even with a single row.
