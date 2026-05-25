import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { MAINNET, REGTEST, SIGNET, TESTNET, TESTNET4 } from '../constants/networks';
import type { InputToSign } from '../types/psbt';
import {
  deriveInputsToSign,
  getBitcoinJsNetwork,
  inputsToSignRecord,
  toXverseInputsToSign,
} from './psbt';

// Well-known mainnet test fixtures (P2WPKH addresses from BIP-173 / community vectors).
const ORDINALS_ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const PAYMENT_ADDR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const OTHER_ADDR = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

function buildPsbtWith(inputs: Array<{ address: string }>): string {
  const network = bitcoin.networks.bitcoin;
  const psbt = new bitcoin.Psbt({ network });
  for (let i = 0; i < inputs.length; i++) {
    const entry = inputs[i];
    if (!entry) continue;
    psbt.addInput({
      hash: '00'.repeat(32),
      index: i,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(entry.address, network),
        value: BigInt(10000 * (i + 1)),
      },
    });
  }
  return psbt.toBase64();
}

describe('getBitcoinJsNetwork', () => {
  it('maps each sighash NetworkType to a bitcoinjs Network', () => {
    expect(getBitcoinJsNetwork(MAINNET)).toBe(bitcoin.networks.bitcoin);
    expect(getBitcoinJsNetwork(TESTNET)).toBe(bitcoin.networks.testnet);
    expect(getBitcoinJsNetwork(TESTNET4)).toBe(bitcoin.networks.testnet);
    expect(getBitcoinJsNetwork(SIGNET)).toBe(bitcoin.networks.testnet);
    expect(getBitcoinJsNetwork(REGTEST)).toBe(bitcoin.networks.regtest);
  });
});

describe('inputsToSignRecord', () => {
  it('groups by address', () => {
    const inputs: InputToSign[] = [
      { index: 0, address: ORDINALS_ADDR },
      { index: 2, address: PAYMENT_ADDR },
      { index: 3, address: ORDINALS_ADDR },
    ];
    expect(inputsToSignRecord(inputs)).toEqual({
      [ORDINALS_ADDR]: [0, 3],
      [PAYMENT_ADDR]: [2],
    });
  });

  it('returns an empty record for an empty array', () => {
    expect(inputsToSignRecord([])).toEqual({});
  });
});

describe('toXverseInputsToSign', () => {
  it('groups indexes by address and collects sigHash', () => {
    const inputs: InputToSign[] = [
      { index: 0, address: ORDINALS_ADDR },
      { index: 1, address: ORDINALS_ADDR, sighashTypes: [0x01] },
      { index: 2, address: PAYMENT_ADDR, sighashTypes: [0x83] },
    ];
    expect(toXverseInputsToSign(inputs)).toEqual([
      { address: ORDINALS_ADDR, signingIndexes: [0, 1], sigHash: 0x01 },
      { address: PAYMENT_ADDR, signingIndexes: [2], sigHash: 0x83 },
    ]);
  });

  it('omits sigHash when no input specifies it', () => {
    const result = toXverseInputsToSign([{ index: 0, address: ORDINALS_ADDR }]);
    expect(result).toEqual([{ address: ORDINALS_ADDR, signingIndexes: [0] }]);
  });

  it('handles an empty input array', () => {
    expect(toXverseInputsToSign([])).toEqual([]);
  });
});

describe('deriveInputsToSign', () => {
  it('returns only inputs whose script matches the ordinals or payment address', () => {
    const psbtBase64 = buildPsbtWith([
      { address: ORDINALS_ADDR },
      { address: PAYMENT_ADDR },
      { address: OTHER_ADDR },
    ]);

    const result = deriveInputsToSign(psbtBase64, {
      ordinalsAddress: ORDINALS_ADDR,
      paymentAddress: PAYMENT_ADDR,
      network: MAINNET,
    });

    expect(result).toEqual([
      { index: 0, address: ORDINALS_ADDR },
      { index: 1, address: PAYMENT_ADDR },
    ]);
  });

  it('preserves input ordering when our addresses appear out of order', () => {
    const psbtBase64 = buildPsbtWith([
      { address: OTHER_ADDR },
      { address: PAYMENT_ADDR },
      { address: OTHER_ADDR },
      { address: ORDINALS_ADDR },
    ]);

    const result = deriveInputsToSign(psbtBase64, {
      ordinalsAddress: ORDINALS_ADDR,
      paymentAddress: PAYMENT_ADDR,
      network: MAINNET,
    });

    expect(result).toEqual([
      { index: 1, address: PAYMENT_ADDR },
      { index: 3, address: ORDINALS_ADDR },
    ]);
  });

  it('returns an empty array when no inputs match', () => {
    const psbtBase64 = buildPsbtWith([{ address: OTHER_ADDR }]);

    const result = deriveInputsToSign(psbtBase64, {
      ordinalsAddress: ORDINALS_ADDR,
      paymentAddress: PAYMENT_ADDR,
      network: MAINNET,
    });

    expect(result).toEqual([]);
  });
});
