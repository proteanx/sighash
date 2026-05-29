import { describe, expect, it } from 'vitest';
import { runSelfTest } from './self-test';

// Validates the TRUC passthrough harness against a local signer: every builder's PSBT is
// signed the way the matching wallet would, then run back through the same verify path the UI
// uses. All rows must PASS — including the negative controls (tampered sig / mutated nVersion).
describe('TRUC passthrough harness self-test', () => {
  for (const row of runSelfTest()) {
    it(row.name, () => {
      expect(row.ok, row.detail).toBe(true);
    });
  }
});
