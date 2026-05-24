import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  base64ToHex,
  bytesToBase64,
  bytesToHex,
  hexToBase64,
  hexToBytes,
  isBase64,
  isHex,
  resolvePsbtFormats,
} from './encoding';

describe('isHex', () => {
  it('accepts even-length hex with mixed case', () => {
    expect(isHex('00')).toBe(true);
    expect(isHex('deadBEEF')).toBe(true);
    expect(isHex('70736274ff')).toBe(true);
  });

  it('rejects odd-length strings', () => {
    expect(isHex('1')).toBe(false);
    expect(isHex('abc')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isHex('foo')).toBe(false);
    expect(isHex('zzzz')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isHex('')).toBe(false);
  });
});

describe('isBase64', () => {
  it('accepts standard base64 with padding', () => {
    expect(isBase64('cHNidP8=')).toBe(true);
    expect(isBase64('aGVsbG8=')).toBe(true);
    expect(isBase64('AAAA')).toBe(true);
  });

  it('rejects invalid characters', () => {
    expect(isBase64('hello.world')).toBe(false);
    expect(isBase64('with space')).toBe(false);
    expect(isBase64('')).toBe(false);
  });
});

describe('hex/bytes round-trip', () => {
  it('preserves bytes through hex', () => {
    const hex = '70736274ff01000000000000000000';
    const bytes = hexToBytes(hex);
    expect(bytesToHex(bytes)).toBe(hex);
  });

  it('preserves bytes for a large payload', () => {
    const big = new Uint8Array(0x10000);
    for (let i = 0; i < big.length; i++) {
      big[i] = i % 256;
    }
    const hex = bytesToHex(big);
    const round = hexToBytes(hex);
    expect(round.length).toBe(big.length);
    for (let i = 0; i < big.length; i++) {
      expect(round[i]).toBe(big[i]);
    }
  });
});

describe('base64/bytes round-trip', () => {
  it('preserves bytes through base64', () => {
    const original = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x00, 0x00, 0x00]);
    const b64 = bytesToBase64(original);
    const round = base64ToBytes(b64);
    expect(round.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(round[i]).toBe(original[i]);
    }
  });

  it('chunked encoder handles payloads larger than 0x8000 bytes', () => {
    const big = new Uint8Array(0x10000);
    for (let i = 0; i < big.length; i++) {
      big[i] = i % 256;
    }
    const b64 = bytesToBase64(big);
    const round = base64ToBytes(b64);
    expect(round.length).toBe(big.length);
    for (let i = 0; i < big.length; i++) {
      expect(round[i]).toBe(big[i]);
    }
  });
});

describe('hex ↔ base64', () => {
  it('round-trips through both directions', () => {
    const hex = '70736274ff01000000000000000000';
    const b64 = hexToBase64(hex);
    expect(base64ToHex(b64)).toBe(hex);
  });
});

describe('resolvePsbtFormats', () => {
  it('resolves a hex-encoded PSBT', () => {
    const hex = '70736274ff01000000';
    const r = resolvePsbtFormats(hex);
    expect(r.tx).toBe(hex);
    expect(r.psbtHex).toBe(hex);
    expect(r.psbtBase64).toBe(hexToBase64(hex));
  });

  it('resolves a base64-encoded PSBT', () => {
    const hex = '70736274ff01000000';
    const b64 = hexToBase64(hex);
    const r = resolvePsbtFormats(b64);
    expect(r.tx).toBe(b64);
    expect(r.psbtBase64).toBe(b64);
    expect(r.psbtHex).toBe(hex);
  });

  it('prefers hex when the input is ambiguous (all-hex chars)', () => {
    // "deadbeef" matches both hex and base64; we check hex first.
    const r = resolvePsbtFormats('deadbeef');
    expect(r.psbtHex).toBe('deadbeef');
  });

  it('throws on garbage input', () => {
    expect(() => resolvePsbtFormats('!!@#$')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => resolvePsbtFormats('')).toThrow();
  });
});
