import type { SigningProtocol } from '../constants/signing-protocol';

/**
 * Per-provider capability descriptor. Consumers should branch on these flags rather than
 * on the provider id — that way the abstraction stays stable when a wallet adds a new
 * primitive (e.g. Xverse shipping a native bulk-sign RPC).
 */
export interface WalletCapabilities {
  /**
   * `'native'` — the wallet exposes a single-prompt bulk RPC and we dispatch to it.
   * `'sequential'` — bulk-sign is emulated as N sequential `signPsbt` prompts; the user
   * will see one wallet prompt per PSBT.
   */
  bulkSign: 'native' | 'sequential';

  /** Message-signing protocols the wallet accepts. */
  signMessageProtocols: readonly SigningProtocol[];

  /** Whether `client.switchNetwork()` is supported. */
  switchNetwork: boolean;
}
