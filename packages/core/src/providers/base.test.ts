import { describe, expect, it } from 'vitest';
import type { SighashClient } from '../client';
import { BIP322 } from '../constants/signing-protocol';
import { UNISAT } from '../constants/wallets';
import { hexToBase64 } from '../lib/encoding';
import { createStores } from '../store';
import type { WalletCapabilities } from '../types/capabilities';
import type {
  InputToSign,
  ResolvedPsbt,
  SignedPsbt,
  WalletProviderSignPsbtOptions,
} from '../types/psbt';
import type { SignMessageOptions } from '../types/sign-message';
import { WalletProvider, pickItemInputsToSign } from './base';

class CountingProvider extends WalletProvider {
  readonly id = UNISAT;
  readonly capabilities: WalletCapabilities = {
    bulkSign: 'sequential',
    signMessageProtocols: [BIP322],
    switchNetwork: false,
  };

  callCount = 0;
  receivedInputs: Array<InputToSign[] | undefined> = [];

  get installed(): boolean {
    return true;
  }
  initialize(): void {}
  dispose(): void {}
  async connect(): Promise<void> {}
  async signMessage(_message: string, _options: SignMessageOptions): Promise<string> {
    return 'sig';
  }
  async signPsbt(options: WalletProviderSignPsbtOptions): Promise<SignedPsbt> {
    this.callCount++;
    this.receivedInputs.push(options.inputsToSign);
    return {
      signedPsbtBase64: options.psbtBase64,
      signedPsbtHex: options.psbtHex,
    };
  }
}

function makePsbt(hex: string): ResolvedPsbt {
  return { tx: hex, psbtHex: hex, psbtBase64: hexToBase64(hex) };
}

function makeProvider(): CountingProvider {
  const stores = createStores();
  const parent = {} as SighashClient;
  return new CountingProvider(stores, parent);
}

describe('WalletProvider.signPsbts (sequential fallback)', () => {
  it('signs N PSBTs in sequence with one call per PSBT', async () => {
    const p = makeProvider();
    const psbts = [makePsbt('aabb'), makePsbt('ccdd'), makePsbt('eeff')];

    const result = await p.signPsbts({ psbts, finalize: false, broadcast: false });

    expect(result.signedPsbts).toHaveLength(3);
    expect(p.callCount).toBe(3);
    expect(result.signedPsbts[0]?.signedPsbtHex).toBe('aabb');
    expect(result.signedPsbts[2]?.signedPsbtHex).toBe('eeff');
  });

  it('invokes onProgress after each PSBT', async () => {
    const p = makeProvider();
    const psbts = [makePsbt('aa'), makePsbt('bb')];
    const progress: Array<[number, number]> = [];

    await p.signPsbts({
      psbts,
      finalize: false,
      broadcast: false,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('throws on empty psbts array', async () => {
    const p = makeProvider();
    await expect(p.signPsbts({ psbts: [], finalize: false, broadcast: false })).rejects.toThrow(
      /No PSBTs provided/,
    );
  });

  it('applies a flat inputsToSign array to every PSBT', async () => {
    const p = makeProvider();
    const psbts = [makePsbt('aa'), makePsbt('bb')];
    const inputs: InputToSign[] = [{ index: 0, address: 'addr' }];

    await p.signPsbts({
      psbts,
      finalize: false,
      broadcast: false,
      inputsToSign: inputs,
    });

    expect(p.receivedInputs).toEqual([inputs, inputs]);
  });

  it('applies a nested inputsToSign array position-by-position', async () => {
    const p = makeProvider();
    const psbts = [makePsbt('aa'), makePsbt('bb')];
    const inputs: InputToSign[][] = [[{ index: 0, address: 'a0' }], [{ index: 1, address: 'a1' }]];

    await p.signPsbts({
      psbts,
      finalize: false,
      broadcast: false,
      inputsToSign: inputs,
    });

    expect(p.receivedInputs[0]).toEqual(inputs[0]);
    expect(p.receivedInputs[1]).toEqual(inputs[1]);
  });
});

describe('pickItemInputsToSign', () => {
  it('returns undefined when input is undefined', () => {
    expect(pickItemInputsToSign(undefined, 0)).toBeUndefined();
  });

  it('returns undefined when input is empty', () => {
    expect(pickItemInputsToSign([], 0)).toBeUndefined();
  });

  it('returns a flat array for every index', () => {
    const flat: InputToSign[] = [{ index: 0, address: 'a' }];
    expect(pickItemInputsToSign(flat, 0)).toBe(flat);
    expect(pickItemInputsToSign(flat, 5)).toBe(flat);
  });

  it('returns per-PSBT slice from nested input', () => {
    const nested: InputToSign[][] = [[{ index: 0, address: 'a' }], [{ index: 1, address: 'b' }]];
    expect(pickItemInputsToSign(nested, 0)).toBe(nested[0]);
    expect(pickItemInputsToSign(nested, 1)).toBe(nested[1]);
  });
});
