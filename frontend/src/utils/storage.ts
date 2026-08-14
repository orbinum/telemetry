/**
 * Typed, failure-tolerant access to localStorage.
 *
 * Storage throws in private mode and when the quota is full, and a UI
 * preference is never worth taking the page down for — every read falls back
 * to a default and every write is best-effort.
 *
 * All persisted keys live here, so what this app writes to a user's browser
 * is one list rather than a grep.
 */

export const STORAGE_KEYS = {
  theme: "theme",
  network: "telemetry.network",
  sort: "telemetry.sort",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Read a value, validated before it is trusted: what is in storage was
 * written by an older version of this app, or by hand.
 */
export function readStored<T>(
  key: StorageKey,
  parse: (raw: string) => T | undefined,
): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : parse(raw);
  } catch {
    return undefined;
  }
}

/** Read a JSON value, returning undefined if it is malformed. */
export function readStoredJson<T>(
  key: StorageKey,
  validate: (value: unknown) => T | undefined,
): T | undefined {
  return readStored(key, (raw) => {
    try {
      return validate(JSON.parse(raw));
    } catch {
      return undefined;
    }
  });
}

export function writeStored(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A preference that fails to persist is not worth reporting.
  }
}

export function writeStoredJson(key: StorageKey, value: unknown): void {
  writeStored(key, JSON.stringify(value));
}
