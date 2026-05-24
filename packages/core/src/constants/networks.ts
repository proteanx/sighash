export const MAINNET = 'mainnet';
export const TESTNET = 'testnet';
export const TESTNET4 = 'testnet4';
export const SIGNET = 'signet';
export const REGTEST = 'regtest';

export const NETWORKS = [MAINNET, TESTNET, TESTNET4, SIGNET, REGTEST] as const;

export type NetworkType = (typeof NETWORKS)[number];

export function isNetworkType(value: unknown): value is NetworkType {
  return typeof value === 'string' && (NETWORKS as readonly string[]).includes(value);
}

export function isMainnet(network: NetworkType): boolean {
  return network === MAINNET;
}

export function isTestnetLike(network: NetworkType): boolean {
  return network !== MAINNET;
}
