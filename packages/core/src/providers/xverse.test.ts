import * as bitcoin from 'bitcoinjs-lib';
import * as satsConnect from 'sats-connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SighashClient } from '../client';
import { TESTNET } from '../constants/networks';
import { BIP322, ECDSA } from '../constants/signing-protocol';
import { XVERSE } from '../constants/wallets';
import { base64ToHex } from '../lib/encoding';
import { createStores } from '../store';
import type { InputToSign } from '../types/psbt';
import { unisatProvider } from './unisat';
import { XverseProvider, xverseProvider } from './xverse';

vi.mock('sats-connect', async (importActual) => {
  const actual = await importActual<typeof import('sats-connect')>();
  return {
    ...actual,
    request: vi.fn(),
    signMultipleTransactions: vi.fn(),
    addListener: vi.fn(() => () => {}),
  };
});

const mockedRequest = vi.mocked(satsConnect.request);
const mockedSignMultiple = vi.mocked(satsConnect.signMultipleTransactions);
const mockedAddListener = vi.mocked(satsConnect.addListener);

const ORDINALS_ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const PAYMENT_ADDR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const OTHER_ADDR = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const ORDINALS_PUBKEY = 'a'.repeat(64);
const PAYMENT_PUBKEY = 'b'.repeat(64);

function buildTestPsbt(addressesByInput: string[]): string {
  const network = bitcoin.networks.bitcoin;
  const psbt = new bitcoin.Psbt({ network });
  for (let i = 0; i < addressesByInput.length; i++) {
    const address = addressesByInput[i];
    if (!address) continue;
    psbt.addInput({
      hash: '00'.repeat(32),
      index: i,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(address, network),
        value: BigInt(10000 + i * 1000),
      },
    });
  }
  return psbt.toBase64();
}

function setXverseInjected(installed: boolean): void {
  const scope = globalThis as typeof globalThis & {
    XverseProviders?: { BitcoinProvider?: unknown };
  };
  if (installed) {
    scope.XverseProviders = { BitcoinProvider: {} };
  } else {
    scope.XverseProviders = undefined;
  }
}

function successResponse<T>(result: T): { status: 'success'; result: T } {
  return { status: 'success', result };
}

function errorResponse(
  code: satsConnect.RpcErrorCode,
  message: string,
): { status: 'error'; error: { code: satsConnect.RpcErrorCode; message: string } } {
  return { status: 'error', error: { code, message } };
}

const SUCCESSFUL_ACCOUNT_RESULT = {
  id: 'xverse-account-1',
  addresses: [
    {
      address: ORDINALS_ADDR,
      publicKey: ORDINALS_PUBKEY,
      purpose: satsConnect.AddressPurpose.Ordinals,
      addressType: satsConnect.AddressType.p2tr,
      walletType: 'software' as const,
    },
    {
      address: PAYMENT_ADDR,
      publicKey: PAYMENT_PUBKEY,
      purpose: satsConnect.AddressPurpose.Payment,
      addressType: satsConnect.AddressType.p2wpkh,
      walletType: 'software' as const,
    },
  ],
  walletType: 'software' as const,
  network: {
    bitcoin: { name: satsConnect.BitcoinNetworkType.Mainnet },
    stacks: { name: satsConnect.StacksNetworkType.Mainnet },
    spark: { name: satsConnect.SparkNetworkType.Mainnet },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  setXverseInjected(true);
});

afterEach(() => {
  setXverseInjected(false);
});

function makeClient() {
  const stores = createStores();
  const client = new SighashClient(stores, { providers: [xverseProvider()] });
  return { stores, client };
}

describe('XverseProvider — installation detection', () => {
  it('reports installed when window.XverseProviders.BitcoinProvider exists', () => {
    const stores = createStores();
    const provider = new XverseProvider(stores, {} as SighashClient);
    expect(provider.installed).toBe(true);
  });

  it('reports not installed otherwise', () => {
    setXverseInjected(false);
    const stores = createStores();
    const provider = new XverseProvider(stores, {} as SighashClient);
    expect(provider.installed).toBe(false);
  });
});

describe('XverseProvider — capabilities', () => {
  it('reports native bulk-sign', () => {
    const stores = createStores();
    const provider = new XverseProvider(stores, {} as SighashClient);
    expect(provider.capabilities.bulkSign).toBe('native');
    expect(provider.capabilities.signMessageProtocols).toEqual([BIP322, ECDSA]);
    expect(provider.capabilities.switchNetwork).toBe(true);
  });
});

describe('XverseProvider.connect', () => {
  it('uses wallet_getAccount silently and populates the store', async () => {
    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));

    const { stores, client } = makeClient();
    await client.connect(XVERSE);

    expect(mockedRequest).toHaveBeenCalledWith('wallet_getAccount', null);
    const state = stores.$store.get();
    expect(state.address).toBe(ORDINALS_ADDR);
    expect(state.paymentAddress).toBe(PAYMENT_ADDR);
    expect(state.publicKey).toBe(ORDINALS_PUBKEY);
    expect(state.paymentPublicKey).toBe(PAYMENT_PUBKEY);
    expect(state.accounts).toEqual([ORDINALS_ADDR, PAYMENT_ADDR]);
    expect(state.connected).toBe(true);
    expect(state.provider).toBe(XVERSE);
  });

  it('falls back to wallet_connect when access is denied', async () => {
    mockedRequest
      .mockResolvedValueOnce(
        errorResponse(satsConnect.RpcErrorCode.INTERNAL_ERROR, 'Failed to get account'),
      )
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));

    const { client } = makeClient();
    await client.connect(XVERSE);

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'wallet_getAccount', null);
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'wallet_connect', {
      addresses: [satsConnect.AddressPurpose.Ordinals, satsConnect.AddressPurpose.Payment],
    });
  });

  it('throws when the user rejects wallet_connect', async () => {
    mockedRequest
      .mockResolvedValueOnce(
        errorResponse(satsConnect.RpcErrorCode.INTERNAL_ERROR, 'Failed to get account'),
      )
      .mockResolvedValueOnce(
        errorResponse(satsConnect.RpcErrorCode.USER_REJECTION, 'User rejected'),
      );

    const { client } = makeClient();
    await expect(client.connect(XVERSE)).rejects.toThrow(/cancelled/i);
  });
});

describe('XverseProvider.signMessage', () => {
  it('maps BIP322 protocol to MessageSigningProtocols.BIP322', async () => {
    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(
        successResponse({
          address: PAYMENT_ADDR,
          messageHash: 'h',
          signature: 'sig',
          protocol: satsConnect.MessageSigningProtocols.BIP322,
        }),
      );

    const { client } = makeClient();
    await client.connect(XVERSE);
    const sig = await client.signMessage('hello', { protocol: BIP322 });

    expect(sig).toBe('sig');
    expect(mockedRequest).toHaveBeenLastCalledWith('signMessage', {
      address: PAYMENT_ADDR,
      message: 'hello',
      protocol: satsConnect.MessageSigningProtocols.BIP322,
    });
  });

  it('maps ECDSA protocol to MessageSigningProtocols.ECDSA', async () => {
    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(
        successResponse({
          address: PAYMENT_ADDR,
          messageHash: 'h',
          signature: 'sig',
          protocol: satsConnect.MessageSigningProtocols.ECDSA,
        }),
      );

    const { client } = makeClient();
    await client.connect(XVERSE);
    await client.signMessage('hello', { protocol: ECDSA });

    expect(mockedRequest).toHaveBeenLastCalledWith('signMessage', {
      address: PAYMENT_ADDR,
      message: 'hello',
      protocol: satsConnect.MessageSigningProtocols.ECDSA,
    });
  });

  it('uses the two-arg form to address override', async () => {
    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(
        successResponse({
          address: ORDINALS_ADDR,
          messageHash: 'h',
          signature: 'sig',
          protocol: satsConnect.MessageSigningProtocols.BIP322,
        }),
      );

    const { client } = makeClient();
    await client.connect(XVERSE);
    await client.signMessage('hello', ORDINALS_ADDR);

    expect(mockedRequest).toHaveBeenLastCalledWith('signMessage', {
      address: ORDINALS_ADDR,
      message: 'hello',
      protocol: satsConnect.MessageSigningProtocols.BIP322,
    });
  });

  it('throws on user rejection', async () => {
    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(errorResponse(satsConnect.RpcErrorCode.USER_REJECTION, 'rejected'));

    const { client } = makeClient();
    await client.connect(XVERSE);
    await expect(client.signMessage('hello')).rejects.toThrow(/rejected/i);
  });
});

describe('XverseProvider.signPsbt', () => {
  it('auto-derives signInputs by parsing the PSBT', async () => {
    const psbtBase64 = buildTestPsbt([ORDINALS_ADDR, PAYMENT_ADDR, OTHER_ADDR]);

    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(successResponse({ psbt: 'cHNidP8=' }));

    const { client } = makeClient();
    await client.connect(XVERSE);
    await client.signPsbt(psbtBase64);

    expect(mockedRequest).toHaveBeenLastCalledWith('signPsbt', {
      psbt: psbtBase64,
      broadcast: false,
      signInputs: {
        [ORDINALS_ADDR]: [0],
        [PAYMENT_ADDR]: [1],
      },
    });
  });

  it('uses caller-supplied inputsToSign verbatim when provided', async () => {
    const psbtBase64 = buildTestPsbt([ORDINALS_ADDR]);
    const inputs: InputToSign[] = [{ index: 0, address: ORDINALS_ADDR }];

    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(successResponse({ psbt: 'cHNidP8=' }));

    const { client } = makeClient();
    await client.connect(XVERSE);
    await client.signPsbt({ tx: psbtBase64, inputsToSign: inputs });

    expect(mockedRequest).toHaveBeenLastCalledWith('signPsbt', {
      psbt: psbtBase64,
      broadcast: false,
      signInputs: {
        [ORDINALS_ADDR]: [0],
      },
    });
  });

  it('returns both hex and base64', async () => {
    const psbtBase64 = buildTestPsbt([ORDINALS_ADDR]);
    const signedBase64 = 'cHNidP8BAA==';

    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(successResponse({ psbt: signedBase64 }));

    const { client } = makeClient();
    await client.connect(XVERSE);
    const result = await client.signPsbt(psbtBase64);

    expect(result.signedPsbtBase64).toBe(signedBase64);
    expect(result.signedPsbtHex).toBe(base64ToHex(signedBase64));
  });

  it('includes txid when wallet broadcasts', async () => {
    const psbtBase64 = buildTestPsbt([ORDINALS_ADDR]);

    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(successResponse({ psbt: 'cHNidP8=', txid: 'tx-1' }));

    const { client } = makeClient();
    await client.connect(XVERSE);
    const result = await client.signPsbt({ tx: psbtBase64, broadcast: true });

    expect(result.txId).toBe('tx-1');
  });

  it('throws on user rejection', async () => {
    const psbtBase64 = buildTestPsbt([ORDINALS_ADDR]);

    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(errorResponse(satsConnect.RpcErrorCode.USER_REJECTION, 'rejected'));

    const { client } = makeClient();
    await client.connect(XVERSE);
    await expect(client.signPsbt(psbtBase64)).rejects.toThrow(/rejected/i);
  });
});

describe('XverseProvider.signPsbts — native bulk path', () => {
  function resolveBulk(signedPsbts: Array<{ psbtBase64: string; txId?: string }>) {
    mockedSignMultiple.mockImplementationOnce(async (options) => {
      options.onFinish?.(signedPsbts);
    });
  }

  function cancelBulk() {
    mockedSignMultiple.mockImplementationOnce(async (options) => {
      options.onCancel?.();
    });
  }

  it('calls signMultipleTransactions with one message and per-PSBT inputs', async () => {
    const a = buildTestPsbt([ORDINALS_ADDR, PAYMENT_ADDR]);
    const b = buildTestPsbt([ORDINALS_ADDR]);

    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));
    resolveBulk([{ psbtBase64: 'cHNidP8=' }, { psbtBase64: 'cHNidP8BAA==' }]);

    const { client } = makeClient();
    await client.connect(XVERSE);
    await client.signPsbts({ psbts: [a, b] });

    expect(mockedSignMultiple).toHaveBeenCalledTimes(1);
    const callArgs = mockedSignMultiple.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.payload.psbts).toHaveLength(2);
    expect(callArgs?.payload.psbts[0]?.psbtBase64).toBe(a);
    expect(callArgs?.payload.psbts[0]?.inputsToSign).toEqual([
      { address: ORDINALS_ADDR, signingIndexes: [0] },
      { address: PAYMENT_ADDR, signingIndexes: [1] },
    ]);
    expect(callArgs?.payload.psbts[1]?.inputsToSign).toEqual([
      { address: ORDINALS_ADDR, signingIndexes: [0] },
    ]);
  });

  it('honors a flat caller-supplied inputsToSign applied to every PSBT', async () => {
    const a = buildTestPsbt([ORDINALS_ADDR]);
    const b = buildTestPsbt([ORDINALS_ADDR]);
    const flat: InputToSign[] = [{ index: 0, address: ORDINALS_ADDR, sighashTypes: [0x83] }];

    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));
    resolveBulk([{ psbtBase64: 'cHNidP8=' }, { psbtBase64: 'cHNidP8=' }]);

    const { client } = makeClient();
    await client.connect(XVERSE);
    await client.signPsbts({ psbts: [a, b], inputsToSign: flat });

    const callArgs = mockedSignMultiple.mock.calls[0]?.[0];
    expect(callArgs?.payload.psbts[0]?.inputsToSign).toEqual([
      { address: ORDINALS_ADDR, signingIndexes: [0], sigHash: 0x83 },
    ]);
    expect(callArgs?.payload.psbts[1]?.inputsToSign).toEqual([
      { address: ORDINALS_ADDR, signingIndexes: [0], sigHash: 0x83 },
    ]);
  });

  it('honors nested per-PSBT inputsToSign', async () => {
    const a = buildTestPsbt([ORDINALS_ADDR]);
    const b = buildTestPsbt([PAYMENT_ADDR]);
    const nested: InputToSign[][] = [
      [{ index: 0, address: ORDINALS_ADDR }],
      [{ index: 0, address: PAYMENT_ADDR }],
    ];

    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));
    resolveBulk([{ psbtBase64: 'cHNidP8=' }, { psbtBase64: 'cHNidP8=' }]);

    const { client } = makeClient();
    await client.connect(XVERSE);
    await client.signPsbts({ psbts: [a, b], inputsToSign: nested });

    const callArgs = mockedSignMultiple.mock.calls[0]?.[0];
    expect(callArgs?.payload.psbts[0]?.inputsToSign).toEqual([
      { address: ORDINALS_ADDR, signingIndexes: [0] },
    ]);
    expect(callArgs?.payload.psbts[1]?.inputsToSign).toEqual([
      { address: PAYMENT_ADDR, signingIndexes: [0] },
    ]);
  });

  it('returns hex + base64 and fires onProgress', async () => {
    const a = buildTestPsbt([ORDINALS_ADDR]);
    const b = buildTestPsbt([ORDINALS_ADDR]);
    const signedA = 'cHNidP8=';
    const signedB = 'cHNidP8BAA==';

    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));
    resolveBulk([{ psbtBase64: signedA }, { psbtBase64: signedB, txId: 'tx-2' }]);

    const { client } = makeClient();
    await client.connect(XVERSE);
    const progress: Array<[number, number]> = [];
    const result = await client.signPsbts({
      psbts: [a, b],
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(result.signedPsbts).toHaveLength(2);
    expect(result.signedPsbts[0]?.signedPsbtBase64).toBe(signedA);
    expect(result.signedPsbts[0]?.signedPsbtHex).toBe(base64ToHex(signedA));
    expect(result.signedPsbts[1]?.signedPsbtBase64).toBe(signedB);
    expect(result.signedPsbts[1]?.txId).toBe('tx-2');
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('rejects when the user cancels the bulk prompt', async () => {
    const a = buildTestPsbt([ORDINALS_ADDR]);
    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));
    cancelBulk();

    const { client } = makeClient();
    await client.connect(XVERSE);
    await expect(client.signPsbts({ psbts: [a] })).rejects.toThrow(/cancel/i);
  });

  it('throws when a PSBT has no inputs matching the connected wallet', async () => {
    const psbtWithNoOursInputs = buildTestPsbt([OTHER_ADDR]);
    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));

    const { client } = makeClient();
    await client.connect(XVERSE);
    await expect(client.signPsbts({ psbts: [psbtWithNoOursInputs] })).rejects.toThrow(
      /Cannot derive inputs to sign/,
    );
    expect(mockedSignMultiple).not.toHaveBeenCalled();
  });
});

describe('XverseProvider.signPsbts — sequential fallback', () => {
  it('falls back to sequential when broadcast: true is requested', async () => {
    const a = buildTestPsbt([ORDINALS_ADDR]);
    const signedA = 'cHNidP8=';

    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(successResponse({ psbt: signedA, txid: 'tx-1' }));

    const { client } = makeClient();
    await client.connect(XVERSE);
    const result = await client.signPsbts({ psbts: [a], broadcast: true });

    expect(mockedSignMultiple).not.toHaveBeenCalled();
    // Sequential fallback uses single signPsbt (request('signPsbt'))
    expect(mockedRequest).toHaveBeenLastCalledWith(
      'signPsbt',
      expect.objectContaining({
        broadcast: true,
      }),
    );
    expect(result.signedPsbts[0]?.txId).toBe('tx-1');
  });
});

describe('XverseProvider.pushPsbt', () => {
  it('throws — Xverse has no standalone broadcast RPC', async () => {
    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));

    const { client } = makeClient();
    await client.connect(XVERSE);
    await expect(client.pushPsbt('deadbeef')).rejects.toThrow(/standalone broadcast/i);
  });
});

describe('XverseProvider.switchNetwork', () => {
  it('forwards to wallet_changeNetwork and updates $network', async () => {
    mockedRequest
      .mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT))
      .mockResolvedValueOnce(successResponse(null));

    const { stores, client } = makeClient();
    await client.connect(XVERSE);
    const provider = client.providers[XVERSE] as XverseProvider;
    await provider.switchNetwork(TESTNET);

    expect(mockedRequest).toHaveBeenLastCalledWith('wallet_changeNetwork', {
      name: satsConnect.BitcoinNetworkType.Testnet,
    });
    expect(stores.$network.get()).toBe(TESTNET);
  });
});

describe('XverseProvider — wallet listeners', () => {
  it('attaches accountChange and networkChange listeners when XVERSE becomes active', async () => {
    mockedRequest.mockResolvedValueOnce(successResponse(SUCCESSFUL_ACCOUNT_RESULT));

    const stores = createStores();
    const client = new SighashClient(stores, { providers: [xverseProvider()] });
    client.initialize();
    await client.connect(XVERSE);

    expect(mockedAddListener).toHaveBeenCalledWith('accountChange', expect.any(Function));
    expect(mockedAddListener).toHaveBeenCalledWith('networkChange', expect.any(Function));
  });

  it('does not attach listeners until XVERSE is active', () => {
    const stores = createStores();
    new SighashClient(stores, {
      providers: [xverseProvider(), unisatProvider()],
    }).initialize();

    expect(mockedAddListener).not.toHaveBeenCalled();
  });
});
