import { hexToBytes } from '@sighash-dev/core';
import * as bitcoin from 'bitcoinjs-lib';

/**
 * Builds a listing-shaped PSBT that mirrors ARKAiD's `buildListingPsbt`:
 * - One input at index 0 with `sighashType = SIGHASH_SINGLE | SIGHASH_ANYONECANPAY`,
 *   `witnessUtxo.script` set to `toOutputScript(ordinalsAddress)`, and `tapInternalKey`
 *   when the seller is on taproot.
 * - One output at index 0 paying the seller's payment address.
 *
 * The `hash` (previous txid) is intentionally fake — wallets sign PSBTs without
 * validating the outpoint exists on-chain. The signature won't be broadcastable, but
 * it's enough to exercise the wallet's signing pipeline end-to-end and verify whether
 * a `tapKeySig` (or `partialSig`) lands on input 0 of the response.
 */
export function buildListingFixturePsbt(options: {
  ordinalsAddress: string;
  paymentAddress: string;
  ordinalsPublicKey: string;
  utxoValueSats?: number;
  payoutValueSats?: number;
}): string {
  const network = pickNetworkForAddress(options.ordinalsAddress);
  const psbt = new bitcoin.Psbt({ network });

  const input: Parameters<bitcoin.Psbt['addInput']>[0] = {
    hash: '00'.repeat(32),
    index: 0,
    witnessUtxo: {
      script: bitcoin.address.toOutputScript(options.ordinalsAddress, network),
      value: BigInt(options.utxoValueSats ?? 10_000),
    },
    sighashType: bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY,
  };

  if (options.ordinalsAddress.startsWith('bc1p') || options.ordinalsAddress.startsWith('tb1p')) {
    // Taproot: provide the x-only internal key so the wallet can match its own key.
    const pubKey = hexToBytes(options.ordinalsPublicKey);
    if (pubKey.length === 33) {
      input.tapInternalKey = pubKey.subarray(1, 33);
    } else if (pubKey.length === 32) {
      input.tapInternalKey = pubKey;
    }
  }

  psbt.addInput(input);

  psbt.addOutput({
    address: options.paymentAddress,
    value: BigInt(options.payoutValueSats ?? 50_000),
  });

  return psbt.toBase64();
}

function pickNetworkForAddress(address: string): bitcoin.Network {
  if (address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3')) {
    return bitcoin.networks.bitcoin;
  }
  return bitcoin.networks.testnet;
}

export interface SignedPsbtSummary {
  inputCount: number;
  input0_keys: string[];
  input0_hasTapKeySig: boolean;
  input0_tapKeySigLen?: number;
  input0_hasPartialSig: boolean;
  input0_partialSigCount: number;
  input0_hasTapScriptSig: boolean;
  input0_sighashType?: number;
  input0_hasTapInternalKey: boolean;
}

/** Inspect what the wallet actually put on input 0. Mirrors the backend's check. */
export function summarizeSignedPsbt(base64: string): SignedPsbtSummary | { error: string } {
  try {
    const psbt = bitcoin.Psbt.fromBase64(base64);
    const input0 = psbt.data.inputs[0];
    if (!input0) {
      return { error: 'PSBT has no input at index 0' };
    }
    return {
      inputCount: psbt.data.inputs.length,
      input0_keys: Object.keys(input0),
      input0_hasTapKeySig: !!input0.tapKeySig,
      input0_tapKeySigLen: input0.tapKeySig?.length,
      input0_hasPartialSig: !!input0.partialSig?.length,
      input0_partialSigCount: input0.partialSig?.length ?? 0,
      input0_hasTapScriptSig: !!input0.tapScriptSig?.length,
      input0_sighashType: input0.sighashType,
      input0_hasTapInternalKey: !!input0.tapInternalKey,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
