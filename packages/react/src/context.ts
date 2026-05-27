import type { SighashClient, Stores } from '@sighash-dev/core';
import { createContext } from 'react';

export interface SighashContextValue {
  client: SighashClient | null;
  stores: Stores | null;
}

export const SighashContext = createContext<SighashContextValue>({
  client: null,
  stores: null,
});
