import type { SigningProtocol } from '../constants/signing-protocol';

export interface SignMessageOptions {
  /**
   * Address to sign with. If omitted, the wallet uses the currently active payment
   * address. The two-arg form `signMessage(message, address)` is supported by passing the
   * address here.
   */
  toSignAddress?: string;

  /**
   * Signing protocol. When omitted, the default is **provider-specific**: UniSat and OKX
   * default to {@link ECDSA} (matching their native default and lasereyes' behavior),
   * while Xverse defaults to {@link BIP322}. Pass an explicit value for consistent
   * cross-wallet output.
   */
  protocol?: SigningProtocol;
}
