import type { SigningProtocol } from '../constants/signing-protocol';

export interface SignMessageOptions {
  /**
   * Address to sign with. If omitted, the wallet uses the currently active payment
   * address. The two-arg form `signMessage(message, address)` is supported by passing the
   * address here.
   */
  toSignAddress?: string;

  /** Signing protocol; defaults to BIP-322 simple when the wallet supports it. */
  protocol?: SigningProtocol;
}
