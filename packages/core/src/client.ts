import type { MapStore, WritableAtom } from 'nanostores';
import type { NetworkType } from './constants/networks';
import type { ProviderType } from './constants/wallets';
import { resolvePsbtFormats } from './lib/encoding';
import type { ProviderFactory, WalletProvider } from './providers/base';
import { type Stores, createInitialStore } from './store';
import type { WalletCapabilities } from './types/capabilities';
import type {
  SignPsbtOptions,
  SignPsbtResponse,
  SignPsbtsOptions,
  SignPsbtsResponse,
} from './types/psbt';
import type { SignMessageOptions } from './types/sign-message';
import type { WalletStore } from './types/store';

export interface SighashConfig {
  /** Initial network. Defaults to `'mainnet'`. */
  network?: NetworkType;
  /** Factories for the wallet providers this client should support. */
  providers?: readonly ProviderFactory[];
}

/**
 * Framework-agnostic Bitcoin wallet client. Mirrors the surface of LaserEyes' client for
 * the ARKAiD swap, plus a first-class {@link signPsbts} and a {@link capabilities}
 * introspection method.
 *
 * The client owns the public API; wallet-specific behavior lives in {@link WalletProvider}
 * subclasses registered via {@link SighashConfig.providers}. Providers are responsible for
 * populating the connection-related store fields during `connect()`; the client wraps the
 * call to set `provider`/`connected` and manage `isConnecting`.
 */
export class SighashClient {
  readonly $store: MapStore<WalletStore>;
  readonly $network: WritableAtom<NetworkType>;
  readonly providers: Partial<Record<ProviderType, WalletProvider>>;

  private disposed = false;

  constructor(stores: Stores, config?: SighashConfig) {
    this.$store = stores.$store;
    this.$network = stores.$network;
    if (config?.network) {
      this.$network.set(config.network);
    }
    this.providers = {};
    for (const factory of config?.providers ?? []) {
      const provider = factory(stores, this);
      this.providers[provider.id] = provider;
    }
  }

  /**
   * Initialize each registered provider (start MutationObservers, attach listeners) and
   * flip `isInitializing` to `false` on the next microtask. Idempotent within one client
   * lifetime; call exactly once after construction.
   */
  initialize(): void {
    if (this.disposed) return;
    this.$store.setKey('isInitializing', true);
    for (const provider of Object.values(this.providers)) {
      provider?.initialize();
    }
    queueMicrotask(() => {
      if (!this.disposed) {
        this.$store.setKey('isInitializing', false);
      }
    });
  }

  /** Tear down provider listeners. Safe to call multiple times. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const provider of Object.values(this.providers)) {
      provider?.dispose();
    }
  }

  async connect(providerId: ProviderType): Promise<void> {
    if (this.disposed) {
      throw new Error('Cannot connect a disposed client');
    }
    const provider = this.providers[providerId];
    if (!provider) {
      throw new Error(`Provider not registered: ${providerId}`);
    }
    this.$store.setKey('isConnecting', true);
    try {
      await provider.connect();
      this.$store.setKey('provider', providerId);
      this.$store.setKey('connected', true);
    } catch (error) {
      this.disconnect();
      throw error;
    } finally {
      this.$store.setKey('isConnecting', false);
    }
  }

  /**
   * Clears every connection-related field in the store but preserves the
   * `hasProvider` install-detection flags (those reflect extension presence, not
   * authorization state).
   */
  disconnect(): void {
    const current = this.$store.get().provider;
    if (current) {
      this.providers[current]?.disconnect();
    }
    const initial = createInitialStore();
    this.$store.set({
      ...initial,
      isInitializing: false,
      hasProvider: this.$store.get().hasProvider,
    });
  }

  async signMessage(
    message: string,
    addressOrOptions?: string | SignMessageOptions,
  ): Promise<string> {
    const options: SignMessageOptions =
      typeof addressOrOptions === 'string'
        ? { toSignAddress: addressOrOptions }
        : (addressOrOptions ?? {});
    return this.requireProvider().signMessage(message, options);
  }

  signPsbt(options: SignPsbtOptions): Promise<SignPsbtResponse>;
  signPsbt(tx: string, finalize?: boolean, broadcast?: boolean): Promise<SignPsbtResponse>;
  async signPsbt(
    arg1: string | SignPsbtOptions,
    arg2?: boolean,
    arg3?: boolean,
  ): Promise<SignPsbtResponse> {
    let tx: string;
    let finalize: boolean;
    let broadcast: boolean;
    let inputsToSign: SignPsbtOptions['inputsToSign'];

    if (typeof arg1 === 'string') {
      tx = arg1;
      finalize = arg2 ?? false;
      broadcast = arg3 ?? false;
      inputsToSign = undefined;
    } else {
      tx = arg1.tx;
      finalize = arg1.finalize ?? false;
      broadcast = arg1.broadcast ?? false;
      inputsToSign = arg1.inputsToSign;
    }

    const resolved = resolvePsbtFormats(tx);
    return this.requireProvider().signPsbt({
      tx: resolved.tx,
      psbtHex: resolved.psbtHex,
      psbtBase64: resolved.psbtBase64,
      finalize,
      broadcast,
      inputsToSign,
    });
  }

  async signPsbts(options: SignPsbtsOptions): Promise<SignPsbtsResponse> {
    if (!options.psbts || options.psbts.length === 0) {
      throw new Error('No PSBTs provided');
    }
    const psbts = options.psbts.map(resolvePsbtFormats);
    return this.requireProvider().signPsbts({
      psbts,
      finalize: options.finalize ?? false,
      broadcast: options.broadcast ?? false,
      inputsToSign: options.inputsToSign,
      onProgress: options.onProgress,
    });
  }

  async pushPsbt(txHexOrBase64: string): Promise<string | undefined> {
    return this.requireProvider().pushPsbt(txHexOrBase64);
  }

  /**
   * Returns the capability descriptor for the given provider, or the currently connected
   * provider if `providerId` is omitted. Useful for branching UX on `bulkSign === 'native'`
   * vs `'sequential'`.
   */
  capabilities(providerId?: ProviderType): WalletCapabilities {
    const id = providerId ?? this.$store.get().provider;
    if (!id) {
      throw new Error('No wallet connected and no provider specified');
    }
    const provider = this.providers[id];
    if (!provider) {
      throw new Error(`Provider not registered: ${id}`);
    }
    return provider.capabilities;
  }

  private requireProvider(): WalletProvider {
    if (this.disposed) {
      throw new Error('Client is disposed');
    }
    const id = this.$store.get().provider;
    if (!id) {
      throw new Error('No wallet connected');
    }
    const provider = this.providers[id];
    if (!provider) {
      throw new Error(`Provider not registered: ${id}`);
    }
    return provider;
  }
}
