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

  /**
   * Whether the provider supports a programmatic network switch. `switchNetwork` is a
   * provider-level method (not on {@link SighashClient}); reach it via
   * `client.providers[id]`. `true` for UniSat and Xverse, `false` for OKX (which only
   * switches network through its extension UI).
   */
  switchNetwork: boolean;
}
