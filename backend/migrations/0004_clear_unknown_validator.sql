-- Substrate reports the literal string `<unknown>` as the validator address
-- when a node runs with --validator but cannot name its authority yet. The
-- parsers now drop it, but sessions recorded before that fix stored it, and
-- readLastValidatorAddress picks the most recent non-NULL row — so one such
-- row would keep shadowing the real address a node reported earlier.
UPDATE node_sessions SET validator = NULL WHERE validator = '<unknown>';
