/**
 * Legacy version splitting: old-style clients encode the target triple inside
 * the version string (reference: split_old_style_version in node_message.rs).
 */

// Matches the reference's is_version_or_hash: digits, '.', and hex letters a-f.
function isVersionOrHash(part: string): boolean {
  return /^[0-9a-f.]*$/.test(part);
}

/**
 * Split an old-style `$version-$commit-$arch-$os-$env` string ($commit and
 * $env optional). Returns null if the string doesn't have that shape.
 */
export function splitOldStyleVersion(
  versionAndTarget: string,
): { version: string; targetArch: string; targetOs: string; targetEnv: string } | null {
  const parts = versionAndTarget.split("-");
  if (parts.length < 3) return null;

  // The third part from the end is either $arch (3-part target) or the tail
  // of the version/commit (2-part target) — disambiguated by its alphabet.
  const pivot = parts[parts.length - 3];
  const targetLen = isVersionOrHash(pivot) ? 2 : 3;
  const versionParts = parts.slice(0, -targetLen);
  if (versionParts.length === 0) return null;

  const [targetArch, targetOs, targetEnv = ""] = parts.slice(-targetLen);
  return { version: versionParts.join("-"), targetArch, targetOs, targetEnv };
}
