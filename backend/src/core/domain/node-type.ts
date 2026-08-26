/**
 * What kind of node this is, for the feed's Type column.
 *
 * The protocol reports one role bit, `authority`, set by `--validator`. There
 * is no RPC signal on the wire — serving RPC is a separate flag on the same
 * binary — so "rpc" here means "not an authority" rather than "confirmed to
 * serve RPC". That holds for Orbinum, where every non-validator node is an
 * RPC node; it would not hold on a network running other kinds of full node.
 */

import type { NodeType } from "../../../../shared/protocol/feed";

export function nodeTypeOf(details: { authority?: boolean }): NodeType {
  return details.authority === true ? "validator" : "rpc";
}
