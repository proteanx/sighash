import type { ProviderType } from '../constants/wallets';

export interface WalletStore {
  /** Currently connected wallet provider, or undefined if disconnected. */
  provider: ProviderType | undefined;

  /** Ordinals (taproot) address. Empty string when disconnected. */
  address: string;

  /** Payment address. Empty string when disconnected. */
  paymentAddress: string;

  /** Ordinals address public key (hex). Empty string when disconnected. */
  publicKey: string;

  /** Payment address public key (hex). Required for nested-segwit (P2SH-P2WPKH) addresses. */
  paymentPublicKey: string;

  /** All addresses returned by the wallet at connect time. */
  accounts: string[];

  /** True after `connect()` resolves successfully. */
  connected: boolean;

  /** True while a `connect()` call is in flight. */
  isConnecting: boolean;

  /** True during first-mount provider detection. */
  isInitializing: boolean;

  /** Synchronous install-detection flags, populated by each provider's MutationObserver. */
  hasProvider: Record<ProviderType, boolean | undefined>;
}
