/**
 * Wire types for the node→server telemetry protocol.
 *
 * These mirror the JSON accepted by Parity's telemetry_shard
 * (substrate-telemetry/backend/telemetry_shard/src/json_message/). The
 * protocol is fixed by the Substrate client — field names and optionality are
 * not ours to change.
 */

/** 32-byte block hash, normalized to lowercase `0x`-prefixed hex. */
export type BlockHash = string;

export interface BlockRef {
  hash: BlockHash;
  height: number;
}

export interface NodeSysInfo {
  cpu?: string;
  memory?: number;
  coreCount?: number;
  linuxKernel?: string;
  linuxDistro?: string;
  isVirtualMachine?: boolean;
}

export interface NodeDetails {
  chain: string;
  name: string;
  implementation: string;
  version: string;
  networkId: string;
  validator?: string;
  /** Unix ms as a string — the client sends it quoted. */
  startupTime?: string;
  targetOs?: string;
  targetArch?: string;
  targetEnv?: string;
  sysinfo?: NodeSysInfo;
  ip?: string;
}

export interface SystemConnectedMessage {
  msg: "system.connected";
  id: number;
  genesisHash: BlockHash;
  node: NodeDetails;
}

/**
 * All fields optional: real nodes split one interval into two frames (one with
 * block/finalized/txcount, one with peers/bandwidth), merged later in state.
 */
export interface SystemIntervalMessage {
  msg: "system.interval";
  id: number;
  peers?: number;
  txcount?: number;
  bandwidthUpload?: number;
  bandwidthDownload?: number;
  finalizedHeight?: number;
  finalizedHash?: BlockHash;
  /** `best` + `height` arrive flattened at the payload's top level. */
  block?: BlockRef;
  usedStateCacheSize?: number;
}

export interface BlockImportMessage {
  msg: "block.import";
  id: number;
  /** Wire: `best` (hash) + `height` — height is a JSON **number** here. */
  block: BlockRef;
}

export interface NotifyFinalizedMessage {
  msg: "notify.finalized";
  id: number;
  /**
   * Wire: `best` (hash) + `height` — height is a JSON **string** here, unlike
   * block.import. Real asymmetry in the protocol (plan §7); parsed to number.
   */
  block: BlockRef;
}

export interface AfgAuthoritySetMessage {
  msg: "afg.authority_set";
  id: number;
  /** Only field the reference reads. Requires node verbosity ≥ 1. */
  authorityId: string;
}

export interface HwBenchMessage {
  msg: "sysinfo.hwbench";
  id: number;
  cpuHashrateScore: number;
  memoryMemcpyScore: number;
  diskSequentialWriteScore?: number;
  diskRandomWriteScore?: number;
  parallelCpuHashrateScore?: number;
}

export type NodeMessage =
  | SystemConnectedMessage
  | SystemIntervalMessage
  | BlockImportMessage
  | NotifyFinalizedMessage
  | AfgAuthoritySetMessage
  | HwBenchMessage;
