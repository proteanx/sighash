import { type MockedFunction, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SighashClient } from '../client';
import { MAINNET, TESTNET } from '../constants/networks';
import { BIP322, ECDSA } from '../constants/signing-protocol';
import { OKX } from '../constants/wallets';
import { hexToBase64 } from '../lib/encoding';
import { createStores } from '../store';
import type { InputToSign } from '../types/psbt';
import { type OkxLibrary, OkxProvider, okxProvider } from './okx';

type MockOkx = {
  connect: MockedFunction<OkxLibrary['connect']>;
  signMessage: MockedFunction<OkxLibrary['signMessage']>;
  signPsbt: MockedFunction<OkxLibrary['signPsbt']>;
  signPsbts: MockedFunction<NonNullable<OkxLibrary['signPsbts']>>;
  signMultiplePsbts: MockedFunction<NonNullable<OkxLibrary['signMultiplePsbts']>>;
  pushPsbt: MockedFunction<NonNullable<OkxLibrary['pushPsbt']>>;
  getNetwork: MockedFunction<NonNullable<OkxLibrary['getNetwork']>>;
};

function createBaseMock(): MockOkx {
  return {
    connect: vi.fn(async () => ({
      address: 'bc1pordinalsaddress',
      publicKey: 'a'.repeat(64),
      compressedPublicKey: 'a'.repeat(66),
    })),
    signMessage: vi.fn(async () => 'mock-signature'),
    signPsbt: vi.fn(async (hex: string) => `${hex}aa`),
    signPsbts: vi.fn(async (hexs: string[]) => hexs.map((h) => `${h}aa`)),
    signMultiplePsbts: vi.fn(async (hexs: string[]) => hexs.map((h) => `${h}bb`)),
    pushPsbt: vi.fn(async () => 'mock-txid'),
    getNetwork: vi.fn(async () => 'livenet'),
  };
}

interface InstallOptions {
  mainnet?: MockOkx | null;
  testnet?: MockOkx | null;
}

function installWallet(options: InstallOptions): void {
  const scope = globalThis as typeof globalThis & {
    okxwallet?: { bitcoin?: OkxLibrary; bitcoinTestnet?: OkxLibrary };
  };
  scope.okxwallet = {};
  if (options.mainnet) scope.okxwallet.bitcoin = options.mainnet as unknown as OkxLibrary;
  if (options.testnet) scope.okxwallet.bitcoinTestnet = options.testnet as unknown as OkxLibrary;
}

function uninstallWallet(): void {
  const scope = globalThis as typeof globalThis & { okxwallet?: unknown };
  scope.okxwallet = undefined;
}

let mainnetLib: MockOkx;
let testnetLib: MockOkx;

beforeEach(() => {
  mainnetLib = createBaseMock();
  testnetLib = createBaseMock();
  installWallet({ mainnet: mainnetLib, testnet: testnetLib });
});

afterEach(() => {
  uninstallWallet();
});

function makeClient(network: 'mainnet' | 'testnet' = 'mainnet') {
  const stores = createStores({ network });
  const client = new SighashClient(stores, { network, providers: [okxProvider()] });
  return { stores, client };
}

describe('OkxProvider — installation detection', () => {
  it('reports installed when okxwallet.bitcoin is present', () => {
    const stores = createStores();
    const provider = new OkxProvider(stores, {} as SighashClient);
    expect(provider.installed).toBe(true);
  });

  it('reports installed when only okxwallet.bitcoinTestnet is present', () => {
    installWallet({ testnet: testnetLib });
    const stores = createStores();
    const provider = new OkxProvider(stores, {} as SighashClient);
    expect(provider.installed).toBe(true);
  });

  it('reports not installed when neither namespace exists', () => {
    uninstallWallet();
    const stores = createStores();
    const provider = new OkxProvider(stores, {} as SighashClient);
    expect(provider.installed).toBe(false);
  });
});

describe('OkxProvider — capabilities', () => {
  it('reports native bulk-sign and no programmatic switchNetwork', () => {
    const stores = createStores();
    const provider = new OkxProvider(stores, {} as SighashClient);
    expect(provider.capabilities.bulkSign).toBe('native');
    expect(provider.capabilities.signMessageProtocols).toEqual([BIP322, ECDSA]);
    expect(provider.capabilities.switchNetwork).toBe(false);
  });
});

describe('OkxProvider — network-namespaced library', () => {
  it('uses okxwallet.bitcoin on mainnet', async () => {
    const { client } = makeClient('mainnet');
    await client.connect(OKX);
    expect(mainnetLib.connect).toHaveBeenCalledTimes(1);
    expect(testnetLib.connect).not.toHaveBeenCalled();
  });

  it('uses okxwallet.bitcoinTestnet on testnet', async () => {
    const { client } = makeClient('testnet');
    await client.connect(OKX);
    expect(testnetLib.connect).toHaveBeenCalledTimes(1);
    expect(mainnetLib.connect).not.toHaveBeenCalled();
  });

  it('throws a clear error when the active network has no OKX namespace', async () => {
    // Wipe the testnet entry while keeping mainnet.
    installWallet({ mainnet: mainnetLib });
    const { client } = makeClient('testnet');
    await expect(client.connect(OKX)).rejects.toThrow(/not available for network "testnet"/);
  });
});

describe('OkxProvider.connect', () => {
  it('populates address/publicKey for both ordinals and payment fields', async () => {
    const { stores, client } = makeClient();
    await client.connect(OKX);
    const state = stores.$store.get();
    expect(state.address).toBe('bc1pordinalsaddress');
    expect(state.paymentAddress).toBe('bc1pordinalsaddress');
    expect(state.publicKey).toBe('a'.repeat(64));
    expect(state.paymentPublicKey).toBe('a'.repeat(64));
    expect(state.accounts).toEqual(['bc1pordinalsaddress']);
    expect(state.connected).toBe(true);
    expect(state.provider).toBe(OKX);
  });

  it('throws on incomplete connect result', async () => {
    mainnetLib.connect.mockResolvedValueOnce({ address: '', publicKey: '' });
    const { client } = makeClient();
    await expect(client.connect(OKX)).rejects.toThrow(/incomplete connect/i);
  });
});

describe('OkxProvider.signMessage — corrects the lasereyes inversion', () => {
  it('maps BIP322 to bip322-simple', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signMessage('hello', { protocol: BIP322 });
    expect(mainnetLib.signMessage).toHaveBeenCalledWith('hello', 'bip322-simple');
  });

  it('maps ECDSA to ecdsa (NOT bip322-simple — the lasereyes OKX impl was inverted)', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signMessage('hello', { protocol: ECDSA });
    expect(mainnetLib.signMessage).toHaveBeenCalledWith('hello', 'ecdsa');
  });

  it('defaults to ecdsa when no protocol is specified', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signMessage('hello');
    expect(mainnetLib.signMessage).toHaveBeenCalledWith('hello', 'ecdsa');
  });
});

describe('OkxProvider.signPsbt — autoFinalized + toSignInputs widening', () => {
  it('always passes autoFinalized explicitly (defaults false)', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signPsbt('70736274ff');
    expect(mainnetLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: false,
    });
  });

  it('passes autoFinalized: true when finalize is true', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signPsbt('70736274ff', true);
    expect(mainnetLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: true,
    });
  });

  it('preserves publicKey + sighashTypes on per-input objects (ARKAiD buyer-offer pattern)', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    const inputs: InputToSign[] = [
      { index: 0, address: 'addr-0', publicKey: 'pk-0', sighashTypes: [0x81] },
      { index: 1, address: 'addr-1', publicKey: 'pk-1', sighashTypes: [0x81] },
      // Index 2 deliberately omitted — placeholder input the seller will fill later.
    ];
    await client.signPsbt({ tx: '70736274ff', inputsToSign: inputs });
    expect(mainnetLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: false,
      toSignInputs: [
        { index: 0, address: 'addr-0', publicKey: 'pk-0', sighashTypes: [0x81] },
        { index: 1, address: 'addr-1', publicKey: 'pk-1', sighashTypes: [0x81] },
      ],
    });
  });

  it('omits toSignInputs when an empty array is passed', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signPsbt({ tx: '70736274ff', inputsToSign: [] });
    expect(mainnetLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: false,
    });
  });

  it('broadcasts when finalize and broadcast are both true', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    mainnetLib.signPsbt.mockResolvedValueOnce('70736274ff01');
    const result = await client.signPsbt({ tx: '70736274ff', finalize: true, broadcast: true });
    expect(mainnetLib.pushPsbt).toHaveBeenCalledWith('70736274ff01');
    expect(result.txId).toBe('mock-txid');
  });

  it('throws when broadcast is requested but the OKX build has no pushPsbt', async () => {
    Reflect.deleteProperty(mainnetLib, 'pushPsbt');
    const { client } = makeClient();
    await client.connect(OKX);
    await expect(
      client.signPsbt({ tx: '70736274ff', finalize: true, broadcast: true }),
    ).rejects.toThrow(/did not expose pushPsbt/);
  });

  it('returns both hex and base64', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    mainnetLib.signPsbt.mockResolvedValueOnce('70736274ff01');
    const result = await client.signPsbt('70736274ff');
    expect(result.signedPsbtHex).toBe('70736274ff01');
    expect(result.signedPsbtBase64).toBe(hexToBase64('70736274ff01'));
  });
});

describe('OkxProvider.signPsbts — native bulk path', () => {
  it('prefers library.signPsbts when present', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] });
    expect(mainnetLib.signPsbts).toHaveBeenCalledTimes(1);
    expect(mainnetLib.signMultiplePsbts).not.toHaveBeenCalled();
    expect(mainnetLib.signPsbt).not.toHaveBeenCalled();
  });

  it('falls back to library.signMultiplePsbts when signPsbts is absent', async () => {
    Reflect.deleteProperty(mainnetLib, 'signPsbts');
    const { client } = makeClient();
    await client.connect(OKX);
    await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] });
    expect(mainnetLib.signMultiplePsbts).toHaveBeenCalledTimes(1);
  });

  it('passes autoFinalized: false by default and the flat inputsToSign once', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    const inputs: InputToSign[] = [{ index: 0, address: 'addr', sighashTypes: [0x81] }];
    await client.signPsbts({ psbts: ['70736274ff'], inputsToSign: inputs });
    expect(mainnetLib.signPsbts).toHaveBeenCalledWith(['70736274ff'], {
      autoFinalized: false,
      toSignInputs: [{ index: 0, address: 'addr', sighashTypes: [0x81] }],
    });
  });

  it('returns one SignedPsbt per input PSBT with hex + base64', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    mainnetLib.signPsbts.mockResolvedValueOnce(['ab01', 'cd02']);
    const result = await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] });
    expect(result.signedPsbts).toHaveLength(2);
    expect(result.signedPsbts[0]?.signedPsbtHex).toBe('ab01');
    expect(result.signedPsbts[0]?.signedPsbtBase64).toBe(hexToBase64('ab01'));
  });

  it('fires onProgress per signed PSBT', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    const progress: Array<[number, number]> = [];
    await client.signPsbts({
      psbts: ['70736274ff', '70736274ff01', '70736274ff02'],
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('throws when bulk RPC returns a different array length', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    mainnetLib.signPsbts.mockResolvedValueOnce(['ab01']);
    await expect(client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] })).rejects.toThrow(
      /returned 1 signed PSBTs for 2 inputs/,
    );
  });
});

describe('OkxProvider.signPsbts — sequential fallback', () => {
  it('falls back when neither bulk method exists', async () => {
    Reflect.deleteProperty(mainnetLib, 'signPsbts');
    Reflect.deleteProperty(mainnetLib, 'signMultiplePsbts');

    const { client } = makeClient();
    await client.connect(OKX);
    await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] });

    expect(mainnetLib.signPsbt).toHaveBeenCalledTimes(2);
  });

  it('falls back when caller passes per-PSBT (nested) inputsToSign', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    const nested: InputToSign[][] = [[{ index: 0, address: 'a0' }], [{ index: 1, address: 'a1' }]];
    await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'], inputsToSign: nested });

    expect(mainnetLib.signPsbts).not.toHaveBeenCalled();
    expect(mainnetLib.signPsbt).toHaveBeenCalledTimes(2);
    expect(mainnetLib.signPsbt).toHaveBeenNthCalledWith(1, '70736274ff', {
      autoFinalized: false,
      toSignInputs: [{ index: 0, address: 'a0' }],
    });
    expect(mainnetLib.signPsbt).toHaveBeenNthCalledWith(2, '70736274ff01', {
      autoFinalized: false,
      toSignInputs: [{ index: 1, address: 'a1' }],
    });
  });
});

describe('OkxProvider.pushPsbt + getNetwork', () => {
  it('pushPsbt forwards to library.pushPsbt', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    const tx = await client.pushPsbt('hex-payload');
    expect(mainnetLib.pushPsbt).toHaveBeenCalledWith('hex-payload');
    expect(tx).toBe('mock-txid');
  });

  it('pushPsbt throws when library lacks the method', async () => {
    Reflect.deleteProperty(mainnetLib, 'pushPsbt');
    const { client } = makeClient();
    await client.connect(OKX);
    await expect(client.pushPsbt('hex-payload')).rejects.toThrow(/does not expose pushPsbt/);
  });

  it('getNetwork maps livenet to mainnet', async () => {
    const { client } = makeClient();
    await client.connect(OKX);
    const provider = client.providers[OKX] as OkxProvider;
    expect(await provider.getNetwork()).toBe(MAINNET);
  });

  it('getNetwork maps testnet to testnet', async () => {
    testnetLib.getNetwork.mockResolvedValueOnce('testnet');
    const { client } = makeClient('testnet');
    await client.connect(OKX);
    const provider = client.providers[OKX] as OkxProvider;
    expect(await provider.getNetwork()).toBe(TESTNET);
  });

  it('getNetwork returns undefined when library has no getNetwork method', async () => {
    Reflect.deleteProperty(mainnetLib, 'getNetwork');
    const { client } = makeClient();
    await client.connect(OKX);
    const provider = client.providers[OKX] as OkxProvider;
    expect(await provider.getNetwork()).toBeUndefined();
  });
});
