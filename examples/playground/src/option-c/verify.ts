import { bitcoin, bytesEqual, bytesToHex, verifyEcdsa, verifySchnorr } from './crypto';

const SIGHASH_DEFAULT = 0x00;

export interface VerifyOutcome {
  ok: boolean;
  reason: string;
  /** The sighash flag the wallet actually committed to (decoded from the signature). */
  signedSighashType?: number;
}

/**
 * Rebuilds the unsigned {@link bitcoin.Transaction} embedded in a PSBT so we can recompute
 * the BIP341/342 sighash the wallet signed over. We read it back from the *signed* PSBT, so
 * the recomputed sighash reflects whatever the wallet actually committed to (e.g. it catches
 * a wallet that silently rewrote nVersion 3 → 2 — the sig would still verify, but B4's
 * structure check flags the mutation).
 */
export function txFromPsbt(psbt: bitcoin.Psbt): bitcoin.Transaction {
  const tx = new bitcoin.Transaction();
  tx.version = psbt.version;
  tx.locktime = psbt.locktime;
  for (const vin of psbt.txInputs) {
    tx.addInput(vin.hash, vin.index, vin.sequence);
  }
  for (const vout of psbt.txOutputs) {
    tx.addOutput(vout.script, vout.value);
  }
  return tx;
}

export interface Prevouts {
  scripts: Uint8Array[];
  values: bigint[];
}

/** Pulls each input's prevout (script + value) from its `witnessUtxo` for the v1 sighash. */
export function collectPrevouts(psbt: bitcoin.Psbt): Prevouts {
  const scripts: Uint8Array[] = [];
  const values: bigint[] = [];
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const witnessUtxo = psbt.data.inputs[i]?.witnessUtxo;
    if (!witnessUtxo) {
      throw new Error(`Input ${i} has no witnessUtxo; cannot compute the taproot sighash`);
    }
    scripts.push(witnessUtxo.script);
    values.push(witnessUtxo.value);
  }
  return { scripts, values };
}

/** DEFAULT sigs are 64 bytes (implicit 0x00); any explicit flag rides as a 65th byte. */
function sighashTypeFromSig(signature: Uint8Array): number {
  if (signature.length === 64) return SIGHASH_DEFAULT;
  if (signature.length === 65) return signature[64] ?? SIGHASH_DEFAULT;
  throw new Error(`Unexpected schnorr signature length ${signature.length} (want 64 or 65)`);
}

/**
 * Verifies a taproot **key-path** signature (`tapKeySig`) against the given output key.
 * Used for B1a (BIP86 key-path), B2 (TX1 inscription) and B6 (recovery — the output key
 * there is the merkle-tweaked passthrough key, so a wallet that ignored `tapMerkleRoot`
 * and signed with the bare BIP86 tweak fails verification, which is exactly the gate).
 */
export function verifyTapKeySig(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  outputKey: Uint8Array,
  expectedSighashType: number,
): VerifyOutcome {
  const input = psbt.data.inputs[inputIndex];
  if (!input?.tapKeySig) {
    return { ok: false, reason: `No tapKeySig on input ${inputIndex}` };
  }
  const sig = input.tapKeySig;
  let signedSighashType: number;
  try {
    signedSighashType = sighashTypeFromSig(sig);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (signedSighashType !== expectedSighashType) {
    return {
      ok: false,
      signedSighashType,
      reason: `Wallet signed sighash 0x${signedSighashType.toString(16)}, expected 0x${expectedSighashType.toString(16)}`,
    };
  }
  const { scripts, values } = collectPrevouts(psbt);
  const tx = txFromPsbt(psbt);
  const sighash = tx.hashForWitnessV1(inputIndex, scripts, values, signedSighashType);
  const ok = verifySchnorr(sighash, outputKey, sig.subarray(0, 64));
  return {
    ok,
    signedSighashType,
    reason: ok
      ? `Valid key-path schnorr sig over output key ${bytesToHex(outputKey).slice(0, 12)}…`
      : 'Schnorr verification failed against the expected output key',
  };
}

/**
 * Verifies a taproot **script-path** `multi_a` signature: finds the `tapScriptSig` entry for
 * (xOnlyPubkey, leafHash), confirms the requested sighash flag, then checks the schnorr sig
 * against the BIP342 tapscript sighash (which commits to the leaf hash). This is the master
 * gate (B1b) and the seller-leg verification (B1c/B1d/B1e).
 */
export function verifyTapScriptSig(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  xOnlyPubkey: Uint8Array,
  leafHash: Uint8Array,
  expectedSighashType: number,
): VerifyOutcome {
  const input = psbt.data.inputs[inputIndex];
  const entry = input?.tapScriptSig?.find(
    (s) => bytesEqual(s.pubkey, xOnlyPubkey) && bytesEqual(s.leafHash, leafHash),
  );
  if (!entry) {
    return {
      ok: false,
      reason: `No tapScriptSig for (seller key, leaf) on input ${inputIndex}`,
    };
  }
  let signedSighashType: number;
  try {
    signedSighashType = sighashTypeFromSig(entry.signature);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (signedSighashType !== expectedSighashType) {
    return {
      ok: false,
      signedSighashType,
      reason: `Wallet signed sighash 0x${signedSighashType.toString(16)}, expected 0x${expectedSighashType.toString(16)}`,
    };
  }
  const { scripts, values } = collectPrevouts(psbt);
  const tx = txFromPsbt(psbt);
  const sig64 = entry.signature.subarray(0, 64);
  const sighash = tx.hashForWitnessV1(inputIndex, scripts, values, signedSighashType, leafHash);
  const ok = verifySchnorr(sighash, xOnlyPubkey, sig64);
  if (ok) {
    return {
      ok,
      signedSighashType,
      reason: 'Valid multi_a script-path schnorr sig (seller leg) over the tapscript sighash',
    };
  }
  // The 64 sig bytes don't match the sighash for the flag the wallet stamped. Probe which
  // flag they DO match — this catches wallets that stamp the requested flag but actually
  // sign a different message (e.g. stamp 0x83 but sign DEFAULT).
  const actual = probeScriptPathFlag(tx, scripts, values, inputIndex, leafHash, xOnlyPubkey, sig64);
  return {
    ok,
    signedSighashType,
    reason:
      actual !== null
        ? `Wallet stamped 0x${signedSighashType.toString(16)} but the signature bytes are over sighash 0x${actual.toString(16)} — it did not honor the requested flag`
        : 'Schnorr verification failed against the BIP342 tapscript sighash (no standard flag matched)',
  };
}

/** Standard sighash flags, in the order we report them. */
const CANDIDATE_FLAGS = [0x00, 0x01, 0x02, 0x03, 0x81, 0x82, 0x83];

/**
 * Returns the sighash flag whose tapscript sighash the 64-byte signature actually verifies
 * against, or null if none match. Used to diagnose a wallet that signs a different message
 * than the flag it stamped onto the signature.
 */
function probeScriptPathFlag(
  tx: bitcoin.Transaction,
  scripts: Uint8Array[],
  values: bigint[],
  inputIndex: number,
  leafHash: Uint8Array,
  xOnlyPubkey: Uint8Array,
  sig64: Uint8Array,
): number | null {
  for (const flag of CANDIDATE_FLAGS) {
    try {
      const hash = tx.hashForWitnessV1(inputIndex, scripts, values, flag, leafHash);
      if (verifySchnorr(hash, xOnlyPubkey, sig64)) return flag;
    } catch {
      // SINGLE with no output at this index throws — not the flag in use, skip.
    }
  }
  return null;
}

/**
 * Verifies a buyer **segwit-v0** ECDSA signature (`partialSig`) for B3 when the wallet's
 * payment address is native- or nested-segwit. The scriptCode for both P2WPKH and
 * P2SH-P2WPKH is the implicit `1976a914{pubkeyhash}88ac`.
 */
export function verifySegwitSig(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  expectedSighashType: number,
): VerifyOutcome {
  const input = psbt.data.inputs[inputIndex];
  const partial = input?.partialSig?.[0];
  if (!partial) {
    return { ok: false, reason: `No partialSig on input ${inputIndex}` };
  }
  const witnessUtxo = input?.witnessUtxo;
  if (!witnessUtxo) {
    return { ok: false, reason: `No witnessUtxo on input ${inputIndex}` };
  }
  const sig = partial.signature;
  const signedSighashType = sig[sig.length - 1] ?? SIGHASH_DEFAULT;
  if (signedSighashType !== expectedSighashType) {
    return {
      ok: false,
      signedSighashType,
      reason: `Wallet signed sighash 0x${signedSighashType.toString(16)}, expected 0x${expectedSighashType.toString(16)}`,
    };
  }
  const pubkeyHash = bitcoin.crypto.hash160(partial.pubkey);
  const scriptCode = bitcoin.script.compile([
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    pubkeyHash,
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG,
  ]);
  const tx = txFromPsbt(psbt);
  const sighash = tx.hashForWitnessV0(inputIndex, scriptCode, witnessUtxo.value, signedSighashType);
  const ok = verifyEcdsa(sighash, partial.pubkey, sig.subarray(0, sig.length - 1));
  return {
    ok,
    signedSighashType,
    reason: ok ? 'Valid segwit-v0 ECDSA sig (buyer payment input)' : 'ECDSA verification failed',
  };
}

/** True if the wallet added any signature material to this input. */
export function inputIsSigned(psbt: bitcoin.Psbt, inputIndex: number): boolean {
  const input = psbt.data.inputs[inputIndex];
  if (!input) return false;
  return Boolean(
    input.tapKeySig ||
      (input.tapScriptSig && input.tapScriptSig.length > 0) ||
      (input.partialSig && input.partialSig.length > 0) ||
      input.finalScriptWitness ||
      input.finalScriptSig,
  );
}

/**
 * B4 fidelity check: confirms the wallet returned the PSBT structurally unmutated — same
 * nVersion, nLockTime, and identical inputs (outpoint + sequence) and outputs (script +
 * value). Returns a list of mutations; empty means the wallet only added witness/sig fields.
 */
export function compareStructure(originalBase64: string, signedBase64: string): string[] {
  const a = bitcoin.Psbt.fromBase64(originalBase64);
  const b = bitcoin.Psbt.fromBase64(signedBase64);
  const diffs: string[] = [];

  if (a.version !== b.version) diffs.push(`nVersion ${a.version} → ${b.version}`);
  if (a.locktime !== b.locktime) diffs.push(`nLockTime ${a.locktime} → ${b.locktime}`);

  if (a.txInputs.length !== b.txInputs.length) {
    diffs.push(`input count ${a.txInputs.length} → ${b.txInputs.length}`);
  } else {
    for (let i = 0; i < a.txInputs.length; i++) {
      const ai = a.txInputs[i];
      const bi = b.txInputs[i];
      if (!ai || !bi) continue;
      if (!bytesEqual(ai.hash, bi.hash) || ai.index !== bi.index) {
        diffs.push(`input ${i} outpoint changed`);
      }
      if (ai.sequence !== bi.sequence) {
        diffs.push(`input ${i} nSequence ${ai.sequence} → ${bi.sequence}`);
      }
    }
  }

  if (a.txOutputs.length !== b.txOutputs.length) {
    diffs.push(`output count ${a.txOutputs.length} → ${b.txOutputs.length}`);
  } else {
    for (let i = 0; i < a.txOutputs.length; i++) {
      const ao = a.txOutputs[i];
      const bo = b.txOutputs[i];
      if (!ao || !bo) continue;
      if (!bytesEqual(ao.script, bo.script)) diffs.push(`output ${i} script changed`);
      if (ao.value !== bo.value) diffs.push(`output ${i} value ${ao.value} → ${bo.value}`);
    }
  }

  return diffs;
}
