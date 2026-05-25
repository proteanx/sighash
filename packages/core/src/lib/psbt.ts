import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {
  MAINNET,
  type NetworkType,
  REGTEST,
  SIGNET,
  TESTNET,
  TESTNET4,
} from '../constants/networks';
import type { InputToSign } from '../types/psbt';

// bitcoinjs-lib 7.x requires an ECC library to encode/decode taproot (P2TR) scripts.
// Initialize once at module load; without this, address ops on `bc1p...` throw.
bitcoin.initEccLib(ecc);

/**
 * Maps our `NetworkType` to a `bitcoinjs-lib` Network object. Testnet, testnet4 and
 * signet all share the same address prefixes, so they all map to `bitcoin.networks.testnet`.
 */
export function getBitcoinJsNetwork(network: NetworkType): bitcoin.Network {
  switch (network) {
    case MAINNET:
      return bitcoin.networks.bitcoin;
    case TESTNET:
    case TESTNET4:
    case SIGNET:
      return bitcoin.networks.testnet;
    case REGTEST:
      return bitcoin.networks.regtest;
    default:
      return bitcoin.networks.bitcoin;
  }
}

/**
 * Parses a PSBT and returns one {@link InputToSign} per input whose `witnessUtxo` script
 * pays to the supplied ordinals or payment address. Inputs without `witnessUtxo` (legacy
 * non-segwit) default to the payment address — matches lasereyes' Xverse heuristic.
 * Inputs whose script doesn't decode to an address (e.g. placeholder/non-standard) are
 * skipped silently.
 */
export function deriveInputsToSign(
  psbtBase64: string,
  options: {
    ordinalsAddress: string;
    paymentAddress: string;
    network: NetworkType;
  },
): InputToSign[] {
  const network = getBitcoinJsNetwork(options.network);
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
  const result: InputToSign[] = [];

  for (let index = 0; index < psbt.data.inputs.length; index++) {
    const input = psbt.data.inputs[index];
    if (!input) continue;

    // Propagate the PSBT input's sighash type onto the derived InputToSign so providers
    // that need to pass `sigHash` out-of-band (e.g. Xverse's legacy bulk RPC) can.
    const sighashTypes = input.sighashType !== undefined ? [input.sighashType] : undefined;

    if (!input.witnessUtxo) {
      // Non-segwit input — attribute to the payment address.
      result.push({
        index,
        address: options.paymentAddress,
        ...(sighashTypes ? { sighashTypes } : {}),
      });
      continue;
    }

    let address: string;
    try {
      address = bitcoin.address.fromOutputScript(input.witnessUtxo.script, network);
    } catch (err) {
      // Non-standard script we can't decode. Surface it so a silent-skip never hides
      // a real signing problem downstream.
      console.warn(
        `[sighash] deriveInputsToSign: could not decode address for input ${index}; skipping`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (address === options.ordinalsAddress) {
      result.push({
        index,
        address: options.ordinalsAddress,
        ...(sighashTypes ? { sighashTypes } : {}),
      });
    } else if (address === options.paymentAddress) {
      result.push({
        index,
        address: options.paymentAddress,
        ...(sighashTypes ? { sighashTypes } : {}),
      });
    }
  }

  return result;
}

/**
 * Groups an `InputToSign[]` by address into `Record<address, number[]>`, the shape
 * accepted by sats-connect's modern `request('signPsbt', { signInputs })` RPC.
 */
export function inputsToSignRecord(inputs: InputToSign[]): Record<string, number[]> {
  const map: Record<string, number[]> = {};
  for (const input of inputs) {
    const existing = map[input.address];
    if (existing) {
      existing.push(input.index);
    } else {
      map[input.address] = [input.index];
    }
  }
  return map;
}

/**
 * Xverse's legacy `signMultipleTransactions` API expects per-PSBT inputs as
 * `{ address, signingIndexes, sigHash? }[]`. This converts our per-input
 * representation into that shape, grouping by address.
 *
 * Xverse supports a single `sigHash` per address group. If callers pass mixed
 * sighashTypes for the same address, only the first non-undefined value is kept —
 * callers needing per-input sighashes should use single-PSBT signing instead.
 */
export interface XverseInputToSign {
  address: string;
  signingIndexes: number[];
  sigHash?: number;
}

export function toXverseInputsToSign(inputs: InputToSign[]): XverseInputToSign[] {
  const grouped = new Map<string, { signingIndexes: number[]; sigHash: number | undefined }>();
  for (const input of inputs) {
    const sigHash = input.sighashTypes?.[0];
    const existing = grouped.get(input.address);
    if (existing) {
      existing.signingIndexes.push(input.index);
      if (existing.sigHash === undefined && sigHash !== undefined) {
        existing.sigHash = sigHash;
      }
    } else {
      grouped.set(input.address, {
        signingIndexes: [input.index],
        sigHash,
      });
    }
  }
  const result: XverseInputToSign[] = [];
  for (const [address, { signingIndexes, sigHash }] of grouped) {
    const entry: XverseInputToSign = { address, signingIndexes };
    if (sigHash !== undefined) {
      entry.sigHash = sigHash;
    }
    result.push(entry);
  }
  return result;
}
