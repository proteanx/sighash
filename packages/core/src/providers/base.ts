import type { MapStore, WritableAtom } from 'nanostores';
import type { SighashClient } from '../client';
import type { NetworkType } from '../constants/networks';
import type { ProviderType } from '../constants/wallets';
import type { WalletCapabilities } from '../types/capabilities';
import type {
  BulkInputsToSign,
  InputToSign,
  SignPsbtsResponse,
  SignedPsbt,
  WalletProviderSignPsbtOptions,
  WalletProviderSignPsbtsOptions,
} from '../types/psbt';
import type { SignMessageOptions } from '../types/sign-message';
import type { WalletStore } from '../types/store';

/**
 * Picks the `InputToSign[]` slice that applies to PSBT at `index`. Accepts either a flat
 * array (applies to every PSBT) or a nested array (applies position-by-position).
 */
export function pickItemInputsToSign(
  inputsToSign: BulkInputsToSign | undefined,
  index: number,
): InputToSign[] | undefined {
  if (inputsToSign === undefined) return undefined;
  if (inputsToSign.length === 0) return undefined;
  const first = inputsToSign[0];
  if (Array.isArray(first)) {
    return (inputsToSign as InputToSign[][])[index];
  }
  return inputsToSign as InputToSign[];
}

/**
 * Base class for every wallet provider. Subclasses (UnisatProvider, XVerseProvider,
 * OkxProvider, …) override the abstract members and may override `signPsbts` and
 * `pushPsbt` for wallets that expose native bulk-sign or broadcast RPCs.
 *
 * The base `signPsbts` implementation is the **sequential fallback** — one prompt per
 * PSBT — used when the wallet doesn't expose a bulk RPC. Progress is reported via the
 * caller's `onProgress` callback so the consumer UI can render per-item state without
 * caring whether the underlying primitive was native or sequential.
 */
export abstract class WalletProvider {
  abstract readonly id: ProviderType;
  abstract readonly capabilities: WalletCapabilities;

  protected readonly $store: MapStore<WalletStore>;
  protected readonly $network: WritableAtom<NetworkType>;
  protected readonly parent: SighashClient;

  constructor(
    stores: { $store: MapStore<WalletStore>; $network: WritableAtom<NetworkType> },
    parent: SighashClient,
  ) {
    this.$store = stores.$store;
    this.$network = stores.$network;
    this.parent = parent;
  }

  /** Synchronously reports whether the wallet extension is detected in the host page. */
  abstract get installed(): boolean;

  /** Wire up MutationObserver / global listeners. Called once at client construction. */
  abstract initialize(): void;

  /** Tear down listeners. Called when the client is disposed (e.g. React unmount). */
  abstract dispose(): void;

  /**
   * Request the wallet to authorize the connection. On success, must populate `address`,
   * `paymentAddress`, `publicKey`, `paymentPublicKey`, and `accounts` in the store before
   * resolving. The {@link SighashClient.connect} wrapper sets `provider` and `connected`.
   */
  abstract connect(): Promise<void>;

  /** Provider-specific cleanup on disconnect. Default is a no-op. */
  disconnect(): void {
    // intentionally empty; override in providers that hold state outside the store.
  }

  abstract signMessage(message: string, options: SignMessageOptions): Promise<string>;

  /**
   * Sign a single PSBT. Must throw on user cancellation (do not return `undefined`).
   * The client passes both `psbtHex` and `psbtBase64` so the provider can pick whichever
   * encoding its wallet RPC prefers without re-parsing.
   */
  abstract signPsbt(options: WalletProviderSignPsbtOptions): Promise<SignedPsbt>;

  /**
   * Default sequential bulk-sign. Loops `signPsbt` over the input array. Subclasses
   * whose underlying wallet exposes a native bulk RPC (e.g. UniSat's
   * `window.unisat.signPsbts`) should override this for the single-prompt UX.
   */
  async signPsbts(options: WalletProviderSignPsbtsOptions): Promise<SignPsbtsResponse> {
    const { psbts, finalize, broadcast, inputsToSign, onProgress } = options;
    if (psbts.length === 0) {
      throw new Error('No PSBTs provided');
    }
    const signedPsbts: SignedPsbt[] = [];
    for (let i = 0; i < psbts.length; i++) {
      const item = psbts[i];
      if (!item) {
        throw new Error(`Missing PSBT at index ${i}`);
      }
      const itemInputs = pickItemInputsToSign(inputsToSign, i);
      const signed = await this.signPsbt({
        tx: item.tx,
        psbtHex: item.psbtHex,
        psbtBase64: item.psbtBase64,
        finalize,
        broadcast,
        ...(itemInputs !== undefined ? { inputsToSign: itemInputs } : {}),
      });
      signedPsbts.push(signed);
      onProgress?.(i + 1, psbts.length);
    }
    return { signedPsbts };
  }

  /**
   * Default broadcast implementation. Providers that support wallet-side broadcast
   * (UniSat, OKX) should override to dispatch via the extension; otherwise consumers can
   * configure a data-source-backed broadcaster in a later phase.
   */
  async pushPsbt(_txHexOrBase64: string): Promise<string | undefined> {
    throw new Error('pushPsbt is not implemented for this provider');
  }
}

/** Factory signature used to register providers with a {@link SighashClient}. */
export type ProviderFactory = (
  stores: { $store: MapStore<WalletStore>; $network: WritableAtom<NetworkType> },
  parent: SighashClient,
) => WalletProvider;
