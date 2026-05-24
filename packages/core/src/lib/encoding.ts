/**
 * Zero-dependency hex/base64 helpers. We avoid `Buffer` so the library runs unmodified
 * in any browser that supports `globalThis.atob` and `globalThis.btoa` (which is every
 * browser since IE10 and Node since 16).
 */

import type { ResolvedPsbt } from '../types/psbt';

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

export function isHex(value: string): boolean {
  if (value.length === 0 || value.length % 2 !== 0) return false;
  return HEX_REGEX.test(value);
}

export function isBase64(value: string): boolean {
  if (value.length === 0) return false;
  return BASE64_REGEX.test(value);
}

export function hexToBytes(hex: string): Uint8Array {
  if (!isHex(hex)) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    bytes[i] = byte;
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Build the binary string in chunks to avoid `Maximum call stack size exceeded` from
  // String.fromCharCode(...big) on large PSBTs.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (!isBase64(b64)) {
    throw new Error('Invalid base64 string');
  }
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function hexToBase64(hex: string): string {
  return bytesToBase64(hexToBytes(hex));
}

export function base64ToHex(b64: string): string {
  return bytesToHex(base64ToBytes(b64));
}

/**
 * Accepts a PSBT in either hex or base64 form and returns both encodings plus the
 * caller's original input verbatim. Hex is checked first because the hex alphabet is a
 * strict subset of base64's, so a hex-encoded PSBT would also pass `isBase64`.
 *
 * Throws if `tx` is neither valid hex nor valid base64. Note that this does not validate
 * the PSBT internally — that's the wallet's job. We only confirm the byte transcoding
 * round-trips.
 */
export function resolvePsbtFormats(tx: string): ResolvedPsbt {
  if (typeof tx !== 'string' || tx.length === 0) {
    throw new Error('Invalid PSBT: expected a non-empty string');
  }
  if (isHex(tx)) {
    return { tx, psbtHex: tx, psbtBase64: hexToBase64(tx) };
  }
  if (isBase64(tx)) {
    return { tx, psbtHex: base64ToHex(tx), psbtBase64: tx };
  }
  throw new Error('Invalid PSBT format: expected hex or base64');
}
