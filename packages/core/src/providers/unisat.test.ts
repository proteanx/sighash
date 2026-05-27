import { type MockedFunction, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SighashClient } from '../client';
import { MAINNET, TESTNET } from '../constants/networks';
import { BIP322, ECDSA } from '../constants/signing-protocol';
import { UNISAT } from '../constants/wallets';
import { hexToBase64 } from '../lib/encoding';
import { createStores } from '../store';
import type { InputToSign } from '../types/psbt';
import { type UnisatLibrary, UnisatProvider, unisatProvider } from './unisat';

type MockUnisat = {
  [K in keyof UnisatLibrary]: MockedFunction<
    UnisatLibrary[K] extends (...args: infer P) => infer R ? (...args: P) => R : never
  >;
};

function createMockLib(overrides: Partial<MockUnisat> = {}): MockUnisat {
  const lib: MockUnisat = {
    requestAccounts: vi.fn(async () => ['bc1pordinalsaddress']),
    getAccounts: vi.fn(async () => ['bc1pordinalsaddress']),
    getPublicKey: vi.fn(async () => 'a'.repeat(64)),
    signMessage: vi.fn(async (_message: string, _type?: string) => 'mock-signature'),
    // Defaults return valid hex (input + suffix) so downstream hex/base64 conversion
    // works. Individual tests override via mockResolvedValueOnce for specific assertions.
    signPsbt: vi.fn(async (hex: string) => `${hex}aa`),
    signPsbts: vi.fn(async (hexs: string[]) => hexs.map((h) => `${h}aa`)),
    pushPsbt: vi.fn(async () => 'mock-txid'),
    getChain: vi.fn(async () => ({ enum: 'BITCOIN_MAINNET', name: 'mainnet', network: 'livenet' })),
    switchChain: vi.fn(async (chain: string) => ({ enum: chain, name: chain, network: 'livenet' })),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
  return lib;
}

function installLib(lib: MockUnisat | undefined): void {
  const scope = globalThis as typeof globalThis & { unisat?: UnisatLibrary };
  if (lib) {
    scope.unisat = lib as unknown as UnisatLibrary;
  } else {
    scope.unisat = undefined;
  }
}

let mockLib: MockUnisat;

beforeEach(() => {
  mockLib = createMockLib();
  installLib(mockLib);
});

afterEach(() => {
  installLib(undefined);
});

function makeStandaloneProvider(): UnisatProvider {
  const stores = createStores();
  const parent = {} as SighashClient;
  return new UnisatProvider(stores, parent);
}

function makeClient(config?: { forceSequentialBulkSign?: boolean }) {
  const stores = createStores();
  const client = new SighashClient(stores, {
    providers: [unisatProvider(config)],
  });
  return { stores, client };
}

describe('UnisatProvider — installation detection', () => {
  it('reports installed when window.unisat exists', () => {
    const p = makeStandaloneProvider();
    expect(p.installed).toBe(true);
  });

  it('reports not installed when window.unisat is missing', () => {
    installLib(undefined);
    const p = makeStandaloneProvider();
    expect(p.installed).toBe(false);
  });

  it('throws from any wallet method when the extension is missing', async () => {
    installLib(undefined);
    const p = makeStandaloneProvider();
    await expect(p.connect()).rejects.toThrow(/UniSat extension is not installed/);
  });
});

describe('UnisatProvider — capabilities', () => {
  it('defaults to native bulk-sign', () => {
    const p = makeStandaloneProvider();
    expect(p.capabilities.bulkSign).toBe('native');
    expect(p.capabilities.signMessageProtocols).toEqual([BIP322, ECDSA]);
    expect(p.capabilities.switchNetwork).toBe(true);
  });

  it('reports sequential bulk-sign when forceSequentialBulkSign is enabled', () => {
    const stores = createStores();
    const client = new SighashClient(stores, {
      providers: [unisatProvider({ forceSequentialBulkSign: true })],
    });
    expect(client.capabilities(UNISAT).bulkSign).toBe('sequential');
  });
});

describe('UnisatProvider.connect', () => {
  it('requests accounts + public key and populates the store', async () => {
    const { stores, client } = makeClient();
    await client.connect(UNISAT);
    const state = stores.$store.get();
    expect(state.address).toBe('bc1pordinalsaddress');
    expect(state.paymentAddress).toBe('bc1pordinalsaddress');
    expect(state.publicKey).toBe('a'.repeat(64));
    expect(state.paymentPublicKey).toBe('a'.repeat(64));
    expect(state.accounts).toEqual(['bc1pordinalsaddress']);
    expect(state.connected).toBe(true);
    expect(state.provider).toBe(UNISAT);
    expect(mockLib.requestAccounts).toHaveBeenCalledTimes(1);
    expect(mockLib.getPublicKey).toHaveBeenCalledTimes(1);
  });

  it('throws when UniSat returns an empty accounts list', async () => {
    mockLib.requestAccounts.mockResolvedValueOnce([]);
    const { client } = makeClient();
    await expect(client.connect(UNISAT)).rejects.toThrow(/no accounts/i);
  });

  it('throws when UniSat returns an empty public key', async () => {
    mockLib.getPublicKey.mockResolvedValueOnce('');
    const { client } = makeClient();
    await expect(client.connect(UNISAT)).rejects.toThrow(/no public key/i);
  });
});

describe('UnisatProvider.signMessage protocol mapping', () => {
  it('maps BIP322 (default) to UniSat bip322-simple', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signMessage('hello', { protocol: BIP322 });
    expect(mockLib.signMessage).toHaveBeenCalledWith('hello', 'bip322-simple');
  });

  it('maps ECDSA to UniSat ecdsa', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signMessage('hello', { protocol: ECDSA });
    expect(mockLib.signMessage).toHaveBeenCalledWith('hello', 'ecdsa');
  });

  it('defaults to ecdsa when no protocol is specified (matches lasereyes default)', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signMessage('hello');
    expect(mockLib.signMessage).toHaveBeenCalledWith('hello', 'ecdsa');
  });
});

describe('UnisatProvider.signPsbt — autoFinalized semantics', () => {
  it('always passes autoFinalized explicitly when finalize is false', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signPsbt('70736274ff');
    expect(mockLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: false,
    });
  });

  it('passes autoFinalized: true when finalize is true', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signPsbt('70736274ff', true);
    expect(mockLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: true,
    });
  });

  it('passes toSignInputs when inputsToSign is provided', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    const inputs: InputToSign[] = [{ index: 0, address: 'addr', sighashTypes: [0x01] }];
    await client.signPsbt({ tx: '70736274ff', inputsToSign: inputs });
    expect(mockLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: false,
      toSignInputs: [{ index: 0, address: 'addr', sighashTypes: [0x01] }],
    });
  });

  it('omits toSignInputs when inputsToSign is empty', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signPsbt({ tx: '70736274ff', inputsToSign: [] });
    expect(mockLib.signPsbt).toHaveBeenCalledWith('70736274ff', {
      autoFinalized: false,
    });
  });

  it('returns both hex and base64', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    mockLib.signPsbt.mockResolvedValueOnce('70736274ff01');
    const result = await client.signPsbt('70736274ff');
    expect(result.signedPsbtHex).toBe('70736274ff01');
    expect(result.signedPsbtBase64).toBe(hexToBase64('70736274ff01'));
  });

  it('broadcasts when both finalize and broadcast are true', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    mockLib.signPsbt.mockResolvedValueOnce('70736274ff01');
    const result = await client.signPsbt({ tx: '70736274ff', finalize: true, broadcast: true });
    expect(mockLib.pushPsbt).toHaveBeenCalledWith('70736274ff01');
    expect(result.txId).toBe('mock-txid');
  });

  it('does not broadcast when finalize is false', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signPsbt({ tx: '70736274ff', finalize: false, broadcast: true });
    expect(mockLib.pushPsbt).not.toHaveBeenCalled();
  });
});

describe('UnisatProvider.signPsbts — native bulk path', () => {
  it('dispatches to UniSat signPsbts with autoFinalized: false by default', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signPsbts({ psbts: ['70736274ff', '70736274ff01', '70736274ff02'] });
    expect(mockLib.signPsbts).toHaveBeenCalledTimes(1);
    expect(mockLib.signPsbts).toHaveBeenCalledWith(['70736274ff', '70736274ff01', '70736274ff02'], {
      autoFinalized: false,
    });
  });

  it('passes autoFinalized: true through when finalize is requested', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    await client.signPsbts({ psbts: ['70736274ff'], finalize: true });
    expect(mockLib.signPsbts).toHaveBeenCalledWith(['70736274ff'], {
      autoFinalized: true,
    });
  });

  it('returns one SignedPsbt per input PSBT with hex and base64 populated', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    mockLib.signPsbts.mockResolvedValueOnce(['ab01', 'cd02']);
    const result = await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] });
    expect(result.signedPsbts).toHaveLength(2);
    expect(result.signedPsbts[0]?.signedPsbtHex).toBe('ab01');
    expect(result.signedPsbts[0]?.signedPsbtBase64).toBe(hexToBase64('ab01'));
    expect(result.signedPsbts[1]?.signedPsbtHex).toBe('cd02');
    expect(result.signedPsbts[1]?.signedPsbtBase64).toBe(hexToBase64('cd02'));
  });

  it('fires onProgress after each PSBT', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
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

  it('broadcasts each signed PSBT when finalize and broadcast are both true', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    mockLib.signPsbts.mockResolvedValueOnce(['ab01', 'cd02']);
    mockLib.pushPsbt.mockResolvedValueOnce('tx-1').mockResolvedValueOnce('tx-2');
    const result = await client.signPsbts({
      psbts: ['70736274ff', '70736274ff01'],
      finalize: true,
      broadcast: true,
    });
    expect(mockLib.pushPsbt).toHaveBeenCalledTimes(2);
    expect(result.signedPsbts[0]?.txId).toBe('tx-1');
    expect(result.signedPsbts[1]?.txId).toBe('tx-2');
  });

  it('throws when UniSat returns the wrong number of signed PSBTs', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    mockLib.signPsbts.mockResolvedValueOnce(['ab01']);
    await expect(client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] })).rejects.toThrow(
      /returned 1 signed PSBTs for 2 inputs/,
    );
  });
});

describe('UnisatProvider.signPsbts — sequential fallback', () => {
  it('falls back to sequential when forceSequentialBulkSign is set', async () => {
    const { client } = makeClient({ forceSequentialBulkSign: true });
    await client.connect(UNISAT);
    await client.signPsbts({ psbts: ['70736274ff', '70736274ff01'] });
    expect(mockLib.signPsbts).not.toHaveBeenCalled();
    // Sequential fallback uses single signPsbt N times.
    expect(mockLib.signPsbt).toHaveBeenCalledTimes(2);
  });

  it('falls back to sequential when per-PSBT inputsToSign is nested', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    const inputs: InputToSign[][] = [[{ index: 0, address: 'a0' }], [{ index: 1, address: 'a1' }]];
    await client.signPsbts({
      psbts: ['70736274ff', '70736274ff01'],
      inputsToSign: inputs,
    });
    expect(mockLib.signPsbts).not.toHaveBeenCalled();
    expect(mockLib.signPsbt).toHaveBeenCalledTimes(2);
    // Each PSBT receives only its own slice of inputs.
    expect(mockLib.signPsbt).toHaveBeenNthCalledWith(1, '70736274ff', {
      autoFinalized: false,
      toSignInputs: [{ index: 0, address: 'a0' }],
    });
    expect(mockLib.signPsbt).toHaveBeenNthCalledWith(2, '70736274ff01', {
      autoFinalized: false,
      toSignInputs: [{ index: 1, address: 'a1' }],
    });
  });

  it('flat inputsToSign uses the native bulk path with one toSignInputs', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    const inputs: InputToSign[] = [{ index: 0, address: 'a0' }];
    await client.signPsbts({
      psbts: ['70736274ff', '70736274ff01'],
      inputsToSign: inputs,
    });
    expect(mockLib.signPsbts).toHaveBeenCalledTimes(1);
    expect(mockLib.signPsbts).toHaveBeenCalledWith(['70736274ff', '70736274ff01'], {
      autoFinalized: false,
      toSignInputs: [{ index: 0, address: 'a0' }],
    });
  });
});

describe('UnisatProvider.pushPsbt', () => {
  it('forwards the hex to UniSat pushPsbt on the happy path (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { client } = makeClient();
      await client.connect(UNISAT);
      const txId = await client.pushPsbt('hex-payload');
      expect(mockLib.pushPsbt).toHaveBeenCalledWith('hex-payload');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(txId).toBe('mock-txid');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to mempool.space when UniSat library.pushPsbt throws', async () => {
    mockLib.pushPsbt.mockRejectedValueOnce(new Error('UniSat broadcast unavailable'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => 'tx-id-fallback',
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { client } = makeClient();
      await client.connect(UNISAT);
      const txid = await client.pushPsbt('02000000000101abcdef00');
      expect(mockLib.pushPsbt).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mempool.space/api/tx');
      expect(txid).toBe('tx-id-fallback');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to external broadcast'),
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });
});

describe('UnisatProvider.switchNetwork', () => {
  it('maps NetworkType to UniSat chain enum', async () => {
    const { stores } = makeClient();
    const client = new SighashClient(stores, { providers: [unisatProvider()] });
    await client.connect(UNISAT);
    const provider = client.providers[UNISAT] as UnisatProvider;
    await provider.switchNetwork(TESTNET);
    expect(mockLib.switchChain).toHaveBeenCalledWith('BITCOIN_TESTNET');
    expect(stores.$network.get()).toBe(TESTNET);
  });

  it('throws for networks UniSat does not support (regtest)', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    const provider = client.providers[UNISAT] as UnisatProvider;
    await expect(provider.switchNetwork('regtest')).rejects.toThrow(/does not support/);
    expect(mockLib.switchChain).not.toHaveBeenCalled();
  });
});

describe('UnisatProvider.getNetwork', () => {
  it('maps UniSat chain enum to NetworkType', async () => {
    const { client } = makeClient();
    await client.connect(UNISAT);
    const provider = client.providers[UNISAT] as UnisatProvider;
    expect(await provider.getNetwork()).toBe(MAINNET);
  });

  it('returns undefined for unknown chain enums', async () => {
    mockLib.getChain.mockResolvedValueOnce({
      enum: 'FRACTAL_BITCOIN_MAINNET',
      name: 'fractal',
      network: 'livenet',
    });
    const { client } = makeClient();
    await client.connect(UNISAT);
    const provider = client.providers[UNISAT] as UnisatProvider;
    expect(await provider.getNetwork()).toBeUndefined();
  });
});
