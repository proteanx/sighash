import {
  BIP322,
  ECDSA,
  type ProviderFactory,
  type SignMessageOptions,
  type SignedPsbt,
  UNISAT,
  type WalletCapabilities,
  WalletProvider,
  type WalletProviderSignPsbtOptions,
} from '@sighash/core';

/**
 * Phase 1 stand-in for a real wallet. Implements the WalletProvider abstract surface
 * with no real cryptography — used by the playground to verify the abstractions and
 * the React → store wiring work end-to-end without an actual extension installed.
 *
 * Impersonates UniSat (id === 'unisat') so the install-detection UI lights up.
 */
export class MockProvider extends WalletProvider {
  readonly id = UNISAT;

  readonly capabilities: WalletCapabilities = {
    bulkSign: 'sequential',
    signMessageProtocols: [BIP322, ECDSA],
    switchNetwork: false,
  };

  get installed(): boolean {
    return true;
  }

  initialize(): void {
    // Pretend the extension is present.
    this.$store.setKey('hasProvider', {
      ...this.$store.get().hasProvider,
      [UNISAT]: true,
    });
  }

  dispose(): void {}

  async connect(): Promise<void> {
    // Simulate a brief async step so the `isConnecting` flag is observable.
    await new Promise((r) => setTimeout(r, 100));
    this.$store.setKey('address', 'bc1pmock0rdinalsaddress00000000000000000000000000000000');
    this.$store.setKey('paymentAddress', 'bc1qmockpaymentaddress0000000000000000000');
    this.$store.setKey('publicKey', 'a'.repeat(64));
    this.$store.setKey('paymentPublicKey', 'b'.repeat(64));
    this.$store.setKey('accounts', [this.$store.get().address, this.$store.get().paymentAddress]);
  }

  async signMessage(message: string, _options: SignMessageOptions): Promise<string> {
    // Fake "signature" — return base64 of the message bytes.
    return globalThis.btoa(`mock-sig:${message}`);
  }

  async signPsbt(options: WalletProviderSignPsbtOptions): Promise<SignedPsbt> {
    return {
      signedPsbtBase64: options.psbtBase64,
      signedPsbtHex: options.psbtHex,
    };
  }
}

export const mockProvider: ProviderFactory = (stores, parent) => new MockProvider(stores, parent);
