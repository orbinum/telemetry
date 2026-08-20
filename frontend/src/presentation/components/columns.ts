/**
 * Column definitions — one source of truth for the header and the rows, so
 * they cannot drift out of alignment (the grid template lives in
 * components.css and must match this order).
 */

import type { SortKey } from "../../domain/node-order";

export interface Column {
  key: SortKey;
  label: string;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  /** Longer explanation, shown on hover. */
  title?: string;
}

export const COLUMNS: Column[] = [
  { key: "name", label: "Name" },
  { key: "implementation", label: "Implementation" },
  {
    key: "nodeType",
    label: "Type",
    title: "Validator when the node runs with --validator; RPC otherwise",
  },
  {
    key: "validator",
    label: "Address",
    title: "Validator address — requires telemetry verbosity 1 or higher",
  },
  { key: "peers", label: "Peers", numeric: true },
  { key: "txcount", label: "Txs", numeric: true, title: "Transactions in the pool" },
  { key: "best", label: "Best", numeric: true, title: "Best block height" },
  { key: "best", label: "Block hash" },
  {
    key: "blockTime",
    label: "Block time",
    numeric: true,
    title: "Time since this node's previous block",
  },
  {
    key: "propagationTime",
    label: "Propagation",
    numeric: true,
    title: "Delay behind the first node to report this height",
  },
  { key: "finalized", label: "Finalized", numeric: true, title: "Finalized block height" },
  { key: "lastBlockAt", label: "Last block", numeric: true, title: "Time since the last block" },
  { key: "location", label: "Location" },
];
