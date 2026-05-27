'use client';

import {
  type ProviderFactory,
  SighashClient,
  type SighashConfig,
  createStores,
  okxProvider,
  unisatProvider,
  xverseProvider,
} from '@sighash-dev/core';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { SighashContext } from './context';

/**
 * Auto-registered when {@link SighashProviderProps.config.providers} is omitted —
 * matches lasereyes' "register all wallets out of the box" behavior so the React
 * provider is drop-in. Pass `config.providers: []` to opt out entirely; pass a
 * non-empty array to override the default set.
 */
const DEFAULT_PROVIDERS: readonly ProviderFactory[] = [
  unisatProvider(),
  xverseProvider(),
  okxProvider(),
];

export interface SighashProviderProps {
  /**
   * Optional configuration. **Must be stable across renders** (memoize at the call site or
   * define at module scope) — passing a new object every render will dispose and
   * re-create the underlying client on every parent re-render.
   *
   * If `config.providers` is omitted, the React provider auto-registers UniSat, Xverse,
   * and OKX. To register a subset (or none), pass `providers` explicitly:
   * `<SighashProvider config={{ providers: [unisatProvider()] }}>`.
   */
  config?: SighashConfig;
  children: ReactNode;
}

export function SighashProvider({ config, children }: SighashProviderProps) {
  const network = config?.network;
  const providers = config?.providers ?? DEFAULT_PROVIDERS;

  const stores = useMemo(() => createStores(network !== undefined ? { network } : {}), [network]);
  const [client, setClient] = useState<SighashClient | null>(null);

  useEffect(() => {
    const c = new SighashClient(stores, { network, providers });
    setClient(() => c);
    c.initialize();
    return () => {
      c.dispose();
      setClient(null);
    };
  }, [stores, network, providers]);

  const value = useMemo(() => ({ client, stores }), [client, stores]);

  return <SighashContext.Provider value={value}>{children}</SighashContext.Provider>;
}
