/**
 * Parser for the `system.connected` payload — the only message with required
 * fields: if one is missing or mistyped, the whole message fails.
 */

import { INVALID, optBoolean, optNumber, optString, reqString } from "./fields";
import type { Maybe } from "./fields";
import { parseHash } from "./hash";
import {
  MAX_ADDRESS_LENGTH,
  isRealAddress,
  isValidCount,
  isValidPeerId,
  isValidString,
} from "./limits";
import type { NodeSysInfo, SystemConnectedMessage } from "./types";
import { splitOldStyleVersion } from "./version";

function parseSysInfo(raw: unknown): Maybe<NodeSysInfo> {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return INVALID;
  const o = raw as Record<string, unknown>;

  const cpu = optString(o.cpu);
  const memory = optNumber(o.memory);
  const coreCount = optNumber(o.core_count);
  const linuxKernel = optString(o.linux_kernel);
  const linuxDistro = optString(o.linux_distro);
  const isVirtualMachine = optBoolean(o.is_virtual_machine);
  for (const f of [cpu, memory, coreCount, linuxKernel, linuxDistro, isVirtualMachine]) {
    if (f === INVALID) return INVALID;
  }

  // Every one of these is attacker-controlled and lands in DO memory.
  for (const text of [cpu, linuxKernel, linuxDistro]) {
    if (typeof text === "string" && !isValidString(text)) return INVALID;
  }
  for (const count of [memory, coreCount]) {
    if (typeof count === "number" && !isValidCount(count)) return INVALID;
  }

  return {
    cpu: cpu as string | undefined,
    memory: memory as number | undefined,
    coreCount: coreCount as number | undefined,
    linuxKernel: linuxKernel as string | undefined,
    linuxDistro: linuxDistro as string | undefined,
    isVirtualMachine: isVirtualMachine as boolean | undefined,
  };
}

/** Parse a `system.connected` payload, or null if it is malformed. */
export function parseSystemConnected(
  id: number,
  p: Record<string, unknown>,
): SystemConnectedMessage | null {
  const genesisHash = parseHash(p.genesis_hash);
  const chain = reqString(p.chain);
  const name = reqString(p.name);
  const implementation = reqString(p.implementation);
  const version = reqString(p.version);
  const networkId = reqString(p.network_id);
  if (
    genesisHash === null ||
    chain === INVALID ||
    name === INVALID ||
    implementation === INVALID ||
    version === INVALID ||
    networkId === INVALID
  ) {
    return null;
  }

  // Bound the required strings before they reach the node table: these live
  // in DO memory for as long as the node reports, and the DO memory ceiling
  // is the limit Cloudflare does not publish (plan §10, risk #1).
  if (
    !isValidString(chain) ||
    !isValidString(name) ||
    !isValidString(implementation) ||
    !isValidString(version)
  ) {
    return null;
  }

  // network_id is the node's PeerId, and the only field stable enough to key a
  // node's history on. A length bound alone would let one client mint an
  // unlimited number of distinct "nodes", so the shape is checked too.
  if (!isValidPeerId(networkId)) return null;

  // `<unknown>` is Substrate's placeholder for "validator, address not known
  // yet" — dropped here so the column stays empty and the D1 restore can fill it.
  let validator = optString(p.validator);
  if (typeof validator === "string" && !isRealAddress(validator)) validator = undefined;
  const startupTime = optString(p.startup_time);
  const ip = optString(p.ip);
  const sysinfo = parseSysInfo(p.sysinfo);
  let targetOs = optString(p.target_os);
  let targetArch = optString(p.target_arch);
  let targetEnv = optString(p.target_env);
  for (const f of [validator, startupTime, ip, sysinfo, targetOs, targetArch, targetEnv]) {
    if (f === INVALID) return null;
  }

  if (typeof validator === "string" && !isValidString(validator, MAX_ADDRESS_LENGTH)) return null;
  for (const text of [startupTime, ip, targetOs, targetArch, targetEnv]) {
    if (typeof text === "string" && !isValidString(text)) return null;
  }

  // Old-style clients encode the target triple inside the version string.
  let finalVersion = version;
  if (targetOs === undefined && targetArch === undefined && targetEnv === undefined) {
    const split = splitOldStyleVersion(version);
    if (split) {
      finalVersion = split.version;
      targetArch = split.targetArch;
      targetOs = split.targetOs;
      targetEnv = split.targetEnv;
    }
  }

  return {
    msg: "system.connected",
    id,
    genesisHash,
    node: {
      chain,
      name,
      implementation,
      version: finalVersion,
      networkId,
      authority: p.authority === true,
      validator: validator as string | undefined,
      startupTime: startupTime as string | undefined,
      targetOs: targetOs as string | undefined,
      targetArch: targetArch as string | undefined,
      targetEnv: targetEnv as string | undefined,
      sysinfo: sysinfo as NodeSysInfo | undefined,
      ip: ip as string | undefined,
    },
  };
}
