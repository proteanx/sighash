import { describe, expect, it } from 'vitest';
import { SighashClient } from './client';
import { BIP322 } from './constants/signing-protocol';
import { UNISAT } from './constants/wallets';
import type { ProviderFactory } from './providers/base';
import { WalletProvider } from './providers/base';
import { createStores } from './store';
import type { WalletCapabilities } from './types/capabilities';
import type { SignedPsbt, WalletProviderSignPsbtOptions } from './types/psbt';
import type { SignMessageOptions } from './types/sign-message';

class TestProvider extends WalletProvider {
  readonly id = UNISAT;
  readonly capabilities: WalletCapabilities = {
    bulkSign: 'sequential',
    signMessageProtocols: [BIP322],
    switchNetwork: false,
  };

  receivedSignPsbtOptions: WalletProviderSignPsbtOptions | null = null;

  get installed(): boolean {
    return true;
  }
  initialize(): void {}
  dispose(): void {}

  async connect(): Promise<void> {
    this.$store.setKey('address', 'bc1pordinals');
    this.$store.setKey('paymentAddress', 'bc1qpayment');
    this.$store.setKey('publicKey', 'pk-ordinals');
    this.$store.setKey('paymentPublicKey', 'pk-payment');
    this.$store.setKey('accounts', ['bc1pordinals', 'bc1qpayment']);
  }

  async signMessage(message: string, options: SignMessageOptions): Promise<string> {
    return `sig:${message}:${options.toSignAddress ?? 'default'}`;
  }

  async signPsbt(options: WalletProviderSignPsbtOptions): Promise<SignedPsbt> {
    this.receivedSignPsbtOptions = options;
    return { signedPsbtBase64: options.psbtBase64, signedPsbtHex: options.psbtHex };
  }
}

const testProvider: ProviderFactory = (stores, parent) => new TestProvider(stores, parent);

describe('SighashClient lifecycle', () => {
  it('connect populates store fields and flips connected', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });

    await client.connect(UNISAT);

    const state = stores.$store.get();
    expect(state.connected).toBe(true);
    expect(state.provider).toBe(UNISAT);
    expect(state.address).toBe('bc1pordinals');
    expect(state.paymentAddress).toBe('bc1qpayment');
    expect(state.publicKey).toBe('pk-ordinals');
    expect(state.paymentPublicKey).toBe('pk-payment');
    expect(state.accounts).toEqual(['bc1pordinals', 'bc1qpayment']);
  });

  it('toggles isConnecting around the call', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });

    expect(stores.$store.get().isConnecting).toBe(false);
    const promise = client.connect(UNISAT);
    expect(stores.$store.get().isConnecting).toBe(true);
    await promise;
    expect(stores.$store.get().isConnecting).toBe(false);
  });

  it('disconnect clears state but preserves hasProvider flags', async () => {
    const stores = createStores();
    stores.$store.setKey('hasProvider', { unisat: true, xverse: false, okx: undefined });
    const client = new SighashClient(stores, { providers: [testProvider] });

    await client.connect(UNISAT);
    client.disconnect();

    const state = stores.$store.get();
    expect(state.connected).toBe(false);
    expect(state.provider).toBeUndefined();
    expect(state.address).toBe('');
    expect(state.hasProvider.unisat).toBe(true);
    expect(state.hasProvider.xverse).toBe(false);
  });

  it('throws when connecting to an unregistered provider', async () => {
    const stores = createStores();
    const client = new SighashClient(stores);

    await expect(client.connect(UNISAT)).rejects.toThrow(/not registered/);
  });

  it('throws when calling signMessage with no connected wallet', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });

    await expect(client.signMessage('hello')).rejects.toThrow(/No wallet connected/);
  });

  it('signMessage forwards address via the two-arg form', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });
    await client.connect(UNISAT);

    const sig = await client.signMessage('hello', 'bc1pother');
    expect(sig).toBe('sig:hello:bc1pother');
  });
});

describe('SighashClient.signPsbt', () => {
  it('accepts a positional hex string', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });
    await client.connect(UNISAT);

    const result = await client.signPsbt('70736274ff', true, false);
    expect(result.signedPsbtHex).toBe('70736274ff');
  });

  it('accepts an options object with finalize/broadcast/inputsToSign', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });
    await client.connect(UNISAT);

    const provider = client.providers[UNISAT] as TestProvider;
    await client.signPsbt({
      tx: '70736274ff',
      finalize: true,
      broadcast: false,
      inputsToSign: [{ index: 0, address: 'addr' }],
    });

    expect(provider.receivedSignPsbtOptions?.finalize).toBe(true);
    expect(provider.receivedSignPsbtOptions?.broadcast).toBe(false);
    expect(provider.receivedSignPsbtOptions?.inputsToSign).toEqual([{ index: 0, address: 'addr' }]);
  });
});

describe('SighashClient.signPsbts', () => {
  it('dispatches to the provider with resolved formats', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });
    await client.connect(UNISAT);

    const result = await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] });
    expect(result.signedPsbts).toHaveLength(2);
  });

  it('reports progress through to the caller via the provider loop', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });
    await client.connect(UNISAT);

    const progress: Array<[number, number]> = [];
    await client.signPsbts({
      psbts: ['70736274ff', '70736274ff01', '70736274ff0102'],
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('throws on empty psbts array', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });
    await client.connect(UNISAT);

    await expect(client.signPsbts({ psbts: [] })).rejects.toThrow(/No PSBTs provided/);
  });
});

describe('SighashClient.capabilities', () => {
  it('returns the connected provider capabilities', async () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });
    await client.connect(UNISAT);

    expect(client.capabilities().bulkSign).toBe('sequential');
  });

  it('returns capabilities by explicit provider id', () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });

    expect(client.capabilities(UNISAT).bulkSign).toBe('sequential');
  });

  it('throws when neither connected nor given an id', () => {
    const stores = createStores();
    const client = new SighashClient(stores, { providers: [testProvider] });

    expect(() => client.capabilities()).toThrow(/No wallet connected/);
  });
});
