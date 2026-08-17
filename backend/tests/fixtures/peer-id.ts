/**
 * Realistic PeerIds for fixtures.
 *
 * `network_id` is validated as a shape now, not just a length, so a fixture
 * like `"12D3KooWTest"` would be rejected by the parser it is meant to
 * exercise. Tests that build one by hand are testing a value no node could
 * ever send.
 */

/** Base58 alphabet — no 0, O, I or l. */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Length of the Ed25519 PeerIds every Orbinum node reports today. */
const PEER_ID_LENGTH = 52;

/**
 * A deterministic PeerId derived from `seed`, in the same shape a real node
 * sends: `12D3KooW` + base58 padding to 52 characters. Distinct seeds give
 * distinct ids, which is what tests that register several nodes need.
 */
export function peerId(seed: string | number): string {
  const text = String(seed);
  let filler = "";
  for (let i = 0; filler.length < PEER_ID_LENGTH; i++) {
    const source = text.charCodeAt(i % Math.max(text.length, 1)) + i;
    filler += B58[(Number.isNaN(source) ? i : source) % B58.length];
  }
  return ("12D3KooW" + text.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "") + filler).slice(
    0,
    PEER_ID_LENGTH,
  );
}
