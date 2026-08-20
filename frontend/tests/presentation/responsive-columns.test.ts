/**
 * The responsive layout hides columns by `nth-child`, which means the CSS
 * carries hard-coded positions into `COLUMNS`. Adding or reordering a column
 * silently shifts every index past it — which is exactly what happened when
 * the validator column was split into Type and Address: the rules kept hiding
 * the old positions, so the narrow layout dropped `best` and `last block`
 * while showing `txs` and `finalized`, and left more cells visible than the
 * grid had columns for, so every row wrapped out of alignment.
 *
 * These tests read the real stylesheet and assert the two things that must
 * hold for a row to line up with its header: the right columns survive, and
 * the number that survive equals the number the grid template declares.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLUMNS } from "../../src/presentation/components/columns";

const CSS = readFileSync(new URL("../../src/styles/components.css", import.meta.url), "utf8");

/** The `@media (...) { ... }` block whose condition starts with `cond`. */
function mediaBlock(cond: string): string {
  const start = CSS.indexOf(`@media (${cond}`);
  expect(start, `no @media block for ${cond}`).toBeGreaterThan(-1);

  // Walk braces so nested rules inside the block are included, not cut at the
  // first `}`.
  const open = CSS.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(open, i);
  }
  throw new Error(`unbalanced @media block for ${cond}`);
}

function hiddenIn(cond: string): number[] {
  return [...mediaBlock(cond).matchAll(/nth-child\((\d+)\)/g)]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/** Column count in the block's `--node-columns` template. */
function declaredColumns(cond: string): number {
  const template = /--node-columns:([^;]+);/.exec(mediaBlock(cond))?.[1];
  expect(template, `no --node-columns for ${cond}`).toBeDefined();

  // Columns are whitespace-separated; a comma inside minmax() is not a break,
  // so drop the bracketed groups before counting runs.
  return template!
    .trim()
    .replace(/\([^()]*\)/g, "x")
    .split(/\s+/)
    .filter(Boolean).length;
}

function visibleLabels(cond: string): string[] {
  const hidden = new Set(hiddenIn(cond));
  return COLUMNS.filter((_, i) => !hidden.has(i + 1)).map((c) => c.label);
}

describe("responsive node columns", () => {
  it("keeps identity and liveness on a phone", () => {
    // What a phone is for: which node, how far along, is it still moving.
    expect(visibleLabels("width < 48rem")).toEqual(["Name", "Best", "Last block"]);
  });

  it("adds the health columns between phone and desktop", () => {
    expect(visibleLabels("48rem <= width < 80rem")).toEqual([
      "Name",
      "Implementation",
      "Type",
      "Peers",
      "Best",
      "Block time",
      "Last block",
    ]);
  });

  it.each(["width < 48rem", "48rem <= width < 80rem"])(
    "declares exactly as many grid columns as it leaves visible (%s)",
    (cond) => {
      // The misalignment bug: more visible cells than declared columns makes
      // the surplus wrap onto a second grid line, so rows stop matching the
      // header.
      expect(declaredColumns(cond)).toBe(visibleLabels(cond).length);
    },
  );

  it("hides only real column positions", () => {
    for (const cond of ["width < 48rem", "48rem <= width < 80rem"]) {
      for (const index of hiddenIn(cond)) {
        expect(index, `${cond} hides out-of-range column ${index}`).toBeLessThanOrEqual(
          COLUMNS.length,
        );
      }
    }
  });
});
