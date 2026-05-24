export const BIP322 = 'bip322';
export const ECDSA = 'ecdsa';

export const SIGNING_PROTOCOLS = [BIP322, ECDSA] as const;

export type SigningProtocol = (typeof SIGNING_PROTOCOLS)[number];

export function isSigningProtocol(value: unknown): value is SigningProtocol {
  return typeof value === 'string' && (SIGNING_PROTOCOLS as readonly string[]).includes(value);
}
