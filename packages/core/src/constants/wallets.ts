export const UNISAT = 'unisat';
export const XVERSE = 'xverse';
export const OKX = 'okx';

export const PROVIDERS = [UNISAT, XVERSE, OKX] as const;

export type ProviderType = (typeof PROVIDERS)[number];

export function isProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}
