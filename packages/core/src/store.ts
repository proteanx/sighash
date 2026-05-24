import { type MapStore, type WritableAtom, atom, map } from 'nanostores';
import { MAINNET, type NetworkType } from './constants/networks';
import { OKX, UNISAT, XVERSE } from './constants/wallets';
import type { WalletStore } from './types/store';

export interface Stores {
  $store: MapStore<WalletStore>;
  $network: WritableAtom<NetworkType>;
}

export function createInitialStore(): WalletStore {
  return {
    provider: undefined,
    address: '',
    paymentAddress: '',
    publicKey: '',
    paymentPublicKey: '',
    accounts: [],
    connected: false,
    isConnecting: false,
    isInitializing: true,
    hasProvider: {
      [UNISAT]: undefined,
      [XVERSE]: undefined,
      [OKX]: undefined,
    },
  };
}

export function createStores(options?: { network?: NetworkType }): Stores {
  const $store = map<WalletStore>(createInitialStore());
  const $network = atom<NetworkType>(options?.network ?? MAINNET);
  return { $store, $network };
}
