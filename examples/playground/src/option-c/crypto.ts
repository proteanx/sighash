import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';

// bitcoinjs-lib 7.x needs an ECC backend for every taproot (P2TR) op: address
// encoding, control-block parity, finalization. Initialize once at module load — the
// same lib the core package uses internally, so behavior matches production.
bitcoin.initEccLib(ecc);

export { bitcoin, ecc };

/** Drop the leading parity byte of a 33-byte compressed key, yielding the 32-byte x-only key. */
export function toXOnly(pubkey: Uint8Array): Uint8Array {
  if (pubkey.length === 32) return pubkey;
  if (pubkey.length === 33) return pubkey.subarray(1, 33);
  throw new Error(`Expected a 32- or 33-byte pubkey, got ${pubkey.length} bytes`);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Hex string has an odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Bitcoin CompactSize (varint) encoding. Our `multi_a` leaf script is 70 bytes, well under
 * 0xfd, so the single-byte branch is the hot path; the wider branches are kept for
 * correctness when serializing the TapLeaf preimage of arbitrary scripts.
 */
export function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  if (n <= 0xffffffff) {
    return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  }
  throw new Error('compactSize: value too large for this harness');
}

/** BIP340 tagged hash via bitcoinjs-lib's crypto (so we share its SHA-256). */
export function taggedHash(tag: Parameters<typeof bitcoin.crypto.taggedHash>[0], data: Uint8Array) {
  return bitcoin.crypto.taggedHash(tag, data);
}

export interface PlatformKey {
  /** 32-byte private scalar. Throwaway — never used for anything but constructing the script. */
  privateKey: Uint8Array;
  /** 32-byte x-only pubkey = `platform_xonly` in the spec. */
  xOnly: Uint8Array;
}

/**
 * Generates a throwaway secp256k1 keypair for the platform leg. Per the handoff doc the
 * platform key only has to be a valid x-only point inside the `multi_a` script — Track B
 * never asks a wallet to produce the platform signature, so this key signs nothing.
 */
export function generatePlatformKey(): PlatformKey {
  for (let i = 0; i < 16; i++) {
    const candidate = crypto.getRandomValues(new Uint8Array(32));
    if (ecc.isPrivate(candidate)) {
      return { privateKey: candidate, xOnly: ecc.xOnlyPointFromScalar(candidate) };
    }
  }
  throw new Error('Failed to generate a valid platform private key');
}

/** Rebuilds a {@link PlatformKey} from a saved 32-byte private-key hex (UI persistence). */
export function platformKeyFromHex(hex: string): PlatformKey {
  const privateKey = hexToBytes(hex);
  if (privateKey.length !== 32 || !ecc.isPrivate(privateKey)) {
    throw new Error('Invalid platform private key hex (need a valid 32-byte scalar)');
  }
  return { privateKey, xOnly: ecc.xOnlyPointFromScalar(privateKey) };
}

/** Schnorr (BIP340) verify — used for every taproot signature (key-path and tapscript). */
export function verifySchnorr(
  sighash: Uint8Array,
  xOnlyPubkey: Uint8Array,
  signature64: Uint8Array,
): boolean {
  return ecc.verifySchnorr(sighash, xOnlyPubkey, signature64);
}

/** ECDSA verify against a 33-byte compressed key — used for buyer segwit (v0) inputs in B3. */
export function verifyEcdsa(
  sighash: Uint8Array,
  compressedPubkey: Uint8Array,
  signatureDerOrCompact: Uint8Array,
): boolean {
  const compact = derToCompact(signatureDerOrCompact);
  return ecc.verify(sighash, compressedPubkey, compact);
}

/**
 * bitcoinjs stores segwit-v0 partial sigs as DER (+ trailing sighash byte). `ecc.verify`
 * wants the 64-byte compact (r||s) form, so decode the minimal DER here.
 */
function derToCompact(sig: Uint8Array): Uint8Array {
  if (sig.length === 64) return sig;
  // Strip a trailing sighash-type byte if present on a compact sig.
  if (sig.length === 65 && sig[0] !== 0x30) return sig.subarray(0, 64);
  if (sig[0] !== 0x30) throw new Error('Signature is neither compact nor DER');
  let offset = 2; // skip 0x30, total-length
  if (sig[offset] !== 0x02) throw new Error('DER: expected INTEGER for r');
  const rLen = sig[offset + 1] ?? 0;
  const r = sig.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  if (sig[offset] !== 0x02) throw new Error('DER: expected INTEGER for s');
  const sLen = sig[offset + 1] ?? 0;
  const s = sig.subarray(offset + 2, offset + 2 + sLen);
  return concatBytes(leftPad32(stripLeadingZero(r)), leftPad32(stripLeadingZero(s)));
}

function stripLeadingZero(b: Uint8Array): Uint8Array {
  let start = 0;
  while (start < b.length - 1 && b[start] === 0x00) start++;
  return b.subarray(start);
}

function leftPad32(b: Uint8Array): Uint8Array {
  if (b.length === 32) return b;
  if (b.length > 32) throw new Error('Integer longer than 32 bytes');
  const out = new Uint8Array(32);
  out.set(b, 32 - b.length);
  return out;
}
