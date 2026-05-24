'use client';

import { SighashClient, type SighashConfig, createStores } from '@sighash/core';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { SighashContext } from './context';

export interface SighashProviderProps {
  /**
   * Optional configuration. **Must be stable across renders** (memoize at the call site or
   * define at module scope) — passing a new object every render will dispose and
   * re-create the underlying client on every parent re-render.
   */
  config?: SighashConfig;
  children: ReactNode;
}

export function SighashProvider({ config, children }: SighashProviderProps) {
  const network = config?.network;
  const stores = useMemo(() => createStores(network !== undefined ? { network } : {}), [network]);
  const [client, setClient] = useState<SighashClient | null>(null);

  useEffect(() => {
    const c = new SighashClient(stores, config);
    setClient(() => c);
    c.initialize();
    return () => {
      c.dispose();
      setClient(null);
    };
  }, [stores, config]);

  const value = useMemo(() => ({ client, stores }), [client, stores]);

  return <SighashContext.Provider value={value}>{children}</SighashContext.Provider>;
}
