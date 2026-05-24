'use client';

import {
  type NetworkType,
  OKX,
  type ProviderType,
  type SighashClient,
  type SignMessageOptions,
  type SignPsbtOptions,
  type SignPsbtResponse,
  type SignPsbtsOptions,
  type SignPsbtsResponse,
  UNISAT,
  type WalletStore,
  XVERSE,
} from '@sighash/core';
import { useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import { SighashContext } from './context';

interface Snapshot {
  store: WalletStore;
  network: NetworkType;
}

export interface UseSighashValue extends WalletStore {
  /** Active network. */
  network: NetworkType;

  /** Synchronous extension-presence flags, mirrored from `hasProvider` for convenience. */
  hasUnisat: boolean;
  hasXverse: boolean;
  hasOkx: boolean;

  /**
   * Underlying client handle. Use `client.$store.get()` to read fresh state in the same
   * render cycle as a `connect()` call (React state hasn't propagated yet).
   */
  client: SighashClient | null;

  connect: (provider: ProviderType) => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string, addressOrOptions?: string | SignMessageOptions) => Promise<string>;
  signPsbt: (
    arg1: string | SignPsbtOptions,
    finalize?: boolean,
    broadcast?: boolean,
  ) => Promise<SignPsbtResponse>;
  signPsbts: (options: SignPsbtsOptions) => Promise<SignPsbtsResponse>;
  pushPsbt: (txHexOrBase64: string) => Promise<string | undefined>;
}

function notReady(method: string): never {
  throw new Error(`useSighash(): client is not ready yet — cannot call ${method}`);
}

export function useSighash(): UseSighashValue {
  const ctx = useContext(SighashContext);
  if (!ctx.stores) {
    throw new Error('useSighash() must be used inside <SighashProvider>');
  }

  const { client, stores } = ctx;
  const { $store, $network } = stores;

  const snapshotRef = useRef<Snapshot | null>(null);

  const subscribe = useCallback(
    (notify: () => void) => {
      const unsubStore = $store.listen(() => {
        snapshotRef.current = null;
        notify();
      });
      const unsubNetwork = $network.listen(() => {
        snapshotRef.current = null;
        notify();
      });
      return () => {
        unsubStore();
        unsubNetwork();
      };
    },
    [$store, $network],
  );

  const getSnapshot = useCallback((): Snapshot => {
    if (!snapshotRef.current) {
      snapshotRef.current = {
        store: $store.get(),
        network: $network.get(),
      };
    }
    return snapshotRef.current;
  }, [$store, $network]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const connect = useCallback(
    (provider: ProviderType): Promise<void> => {
      if (!client) return notReady('connect');
      return client.connect(provider);
    },
    [client],
  );

  const disconnect = useCallback((): void => {
    if (!client) {
      notReady('disconnect');
    } else {
      client.disconnect();
    }
  }, [client]);

  const signMessage = useCallback(
    (message: string, addressOrOptions?: string | SignMessageOptions): Promise<string> => {
      if (!client) return notReady('signMessage');
      return client.signMessage(message, addressOrOptions);
    },
    [client],
  );

  const signPsbt = useCallback(
    (
      arg1: string | SignPsbtOptions,
      finalize?: boolean,
      broadcast?: boolean,
    ): Promise<SignPsbtResponse> => {
      if (!client) return notReady('signPsbt');
      return typeof arg1 === 'string'
        ? client.signPsbt(arg1, finalize, broadcast)
        : client.signPsbt(arg1);
    },
    [client],
  );

  const signPsbts = useCallback(
    (options: SignPsbtsOptions): Promise<SignPsbtsResponse> => {
      if (!client) return notReady('signPsbts');
      return client.signPsbts(options);
    },
    [client],
  );

  const pushPsbt = useCallback(
    (tx: string): Promise<string | undefined> => {
      if (!client) return notReady('pushPsbt');
      return client.pushPsbt(tx);
    },
    [client],
  );

  return {
    ...snapshot.store,
    network: snapshot.network,
    hasUnisat: snapshot.store.hasProvider[UNISAT] ?? false,
    hasXverse: snapshot.store.hasProvider[XVERSE] ?? false,
    hasOkx: snapshot.store.hasProvider[OKX] ?? false,
    client,
    connect,
    disconnect,
    signMessage,
    signPsbt,
    signPsbts,
    pushPsbt,
  };
}
