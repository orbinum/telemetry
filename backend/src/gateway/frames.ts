/**
 * Frame transport: raw WebSocket message data → text.
 *
 * Substrate's soketto client sends binary frames; accept text too, like the
 * reference (telemetry_shard/src/connection.rs). Binary arrives as Blob
 * (workerd's default binaryType) or ArrayBuffer depending on runtime.
 * Transport-only: knows nothing about the telemetry protocol.
 */

/** Decode a WebSocket frame to text; null for unsupported payload types. */
export function frameToText(data: unknown): string | Promise<string> | null {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return null;
}
