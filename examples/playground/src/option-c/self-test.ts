import {
  type BuildCtx,
  type BuiltTest,
  type InputSignSpec,
  buildB1a,
  buildB1b,
  buildB1c,
  buildB1d,
  buildB1e,
  buildB2,
  buildB3,
  buildB5aSweep,
  buildB5bSellerBatch,
  buildB6,
  buildKeyPathAcp,
} from './builders';
import { bitcoin, bytesToHex, concatBytes, ecc, generatePlatformKey, taggedHash } from './crypto';
import { createBuildCtx } from './track-b';
import { collectPrevouts, txFromPsbt } from './verify';

/**
 * Local key material standing in for a wallet. The self-test signs every PSBT exactly the
 * way the corresponding wallet would (key-path tweak, raw-key tapscript, segwit ECDSA), then
 * runs the wallet's signed bytes back through the *same* verify path Track B uses. If these
 * pass, the construction + sighash + verification are internally consistent — so a real
 * wallet failing a test means a real wallet limitation, not a harness bug.
 */
interface LocalWallet {
  ordinalsPriv: Uint8Array;
  paymentPriv: Uint8Array;
  ordinalsAddress: string;
  ordinalsPublicKeyHex: string;
  paymentAddress: string;
  paymentPublicKeyHex: string;
}

function makeWallet(paymentKind: 'p2tr' | 'p2wpkh'): LocalWallet {
  const network = bitcoin.networks.bitcoin;
  const ordinalsPriv = validPriv();
  const paymentPriv = validPriv();
  const ordinalsPub = compressed(ordinalsPriv);
  const paymentPub = compressed(paymentPriv);

  const ordinals = bitcoin.payments.p2tr({ internalPubkey: ordinalsPub.subarray(1, 33), network });
  const payment =
    paymentKind === 'p2tr'
      ? bitcoin.payments.p2tr({ internalPubkey: paymentPub.subarray(1, 33), network })
      : bitcoin.payments.p2wpkh({ pubkey: paymentPub, network });

  if (!ordinals.address || !payment.address)
    throw new Error('Failed to derive self-test addresses');
  return {
    ordinalsPriv,
    paymentPriv,
    ordinalsAddress: ordinals.address,
    ordinalsPublicKeyHex: bytesToHex(ordinalsPub),
    paymentAddress: payment.address,
    paymentPublicKeyHex: bytesToHex(paymentPub),
  };
}

function ctxFor(wallet: LocalWallet): BuildCtx {
  return createBuildCtx({
    network: 'mainnet',
    ordinalsAddress: wallet.ordinalsAddress,
    ordinalsPublicKeyHex: wallet.ordinalsPublicKeyHex,
    paymentAddress: wallet.paymentAddress,
    paymentPublicKeyHex: wallet.paymentPublicKeyHex,
    platformXOnly: generatePlatformKey().xOnly,
  });
}

/** Signs one PSBT the way the appropriate wallet would, returning signed base64. */
function localSign(
  ctx: BuildCtx,
  wallet: LocalWallet,
  psbtBase64: string,
  specs: InputSignSpec[],
): string {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: ctx.network });
  const { scripts, values } = collectPrevouts(psbt);
  const tx = txFromPsbt(psbt);

  for (const spec of specs) {
    const input = psbt.data.inputs[spec.index];
    if (!input) throw new Error(`No input at ${spec.index}`);
    const type = spec.sighashTypes[0] ?? 0x00;
    const isOrdinals = spec.address === ctx.ordinalsAddress;
    const priv = isOrdinals ? wallet.ordinalsPriv : wallet.paymentPriv;

    if (input.tapLeafScript && input.tapLeafScript.length > 0) {
      // Script-path multi_a: sign with the raw (untweaked) seller key over the tapscript sighash.
      const leafHash = ctx.passthrough.leafHash;
      const sighash = tx.hashForWitnessV1(spec.index, scripts, values, type, leafHash);
      input.tapScriptSig = [
        {
          pubkey: ctx.passthrough.sellerXOnly,
          leafHash,
          signature: schnorrWithType(sighash, wallet.ordinalsPriv, type),
        },
      ];
    } else if (input.tapInternalKey) {
      // Key-path: tweak the key (BIP86, or with the merkle root for recovery) then schnorr-sign.
      const tweaked = tweakPriv(priv, input.tapMerkleRoot);
      const sighash = tx.hashForWitnessV1(spec.index, scripts, values, type);
      input.tapKeySig = schnorrWithType(sighash, tweaked, type);
    } else {
      // Segwit v0 (P2WPKH / P2SH-P2WPKH): ECDSA over the BIP143 sighash, stored as DER + type.
      const witnessUtxo = input.witnessUtxo;
      if (!witnessUtxo) throw new Error(`No witnessUtxo at ${spec.index}`);
      const scriptCode = p2wpkhScriptCode(compressed(priv));
      const sighash = tx.hashForWitnessV0(spec.index, scriptCode, witnessUtxo.value, type);
      const der = encodeDer(ecc.sign(sighash, priv));
      input.partialSig = [
        { pubkey: compressed(priv), signature: concatBytes(der, Uint8Array.of(type)) },
      ];
    }
  }
  return psbt.toBase64();
}

function runBuilt(ctx: BuildCtx, wallet: LocalWallet, built: BuiltTest): boolean {
  const signed = built.psbts.map((psbt, i) => {
    const spec = built.signSpecs[i];
    if (!spec) throw new Error(`No spec at ${i}`);
    return localSign(ctx, wallet, psbt, spec);
  });
  const assertions = built.verify(signed);
  return assertions.length > 0 && assertions.every((a) => a.outcome.ok);
}

export interface SelfTestRow {
  name: string;
  ok: boolean;
  detail: string;
}

/** Runs the full harness against a local signer. All rows should be PASS. */
export function runSelfTest(): SelfTestRow[] {
  const rows: SelfTestRow[] = [];
  const taproot = makeWallet('p2tr');
  const ctxT = ctxFor(taproot);

  const sellerSuite: Array<[string, (c: BuildCtx) => BuiltTest]> = [
    ['KP-ACP', buildKeyPathAcp],
    ['B1a', buildB1a],
    ['B1b', buildB1b],
    ['B1c', buildB1c],
    ['B1d', buildB1d],
    ['B1e', buildB1e],
    ['B2', buildB2],
    ['B5b', buildB5bSellerBatch],
    ['B6', buildB6],
  ];
  for (const [name, build] of sellerSuite) {
    rows.push(safeRow(name, () => runBuilt(ctxT, taproot, build(ctxT))));
  }

  // Buyer tests across both payment-address kinds.
  rows.push(safeRow('B3 (taproot buyer)', () => runBuilt(ctxT, taproot, buildB3(ctxT))));
  rows.push(
    safeRow('B5a-3 (taproot buyer)', () => runBuilt(ctxT, taproot, buildB5aSweep(ctxT, 3))),
  );

  const segwit = makeWallet('p2wpkh');
  const ctxS = ctxFor(segwit);
  rows.push(safeRow('B3 (segwit buyer)', () => runBuilt(ctxS, segwit, buildB3(ctxS))));
  rows.push(safeRow('B5a-3 (segwit buyer)', () => runBuilt(ctxS, segwit, buildB5aSweep(ctxS, 3))));

  // Negative controls: the verifier must REJECT a tampered signature and a mutated structure.
  rows.push(
    safeRow('NEG: tampered script-path sig rejected', () => {
      const built = buildB1c(ctxT);
      const psbt = built.psbts[0];
      const spec = built.signSpecs[0];
      if (!psbt || !spec) throw new Error('missing');
      const signed = localSign(ctxT, taproot, psbt, spec);
      const parsed = bitcoin.Psbt.fromBase64(signed, { network: ctxT.network });
      const entry = parsed.data.inputs[0]?.tapScriptSig?.[0];
      if (!entry) throw new Error('no sig to tamper');
      entry.signature = flipByte(entry.signature, 0);
      const outcome = built.verify([parsed.toBase64()]);
      // Expect the crypto assertion to FAIL → negative control passes when it does.
      return outcome.some((a) => !a.outcome.ok);
    }),
  );
  rows.push(
    safeRow('NEG: nVersion mutation flagged by B4', () => {
      const built = buildB1a(ctxT);
      const psbt = built.psbts[0];
      const spec = built.signSpecs[0];
      if (!psbt || !spec) throw new Error('missing');
      // Simulate a wallet that rewrote v3 → v2 before signing (mutate pre-sign, since
      // bitcoinjs forbids setVersion once signatures exist).
      const mutated = bitcoin.Psbt.fromBase64(psbt, { network: ctxT.network });
      mutated.setVersion(2);
      const signed = localSign(ctxT, taproot, mutated.toBase64(), spec);
      const outcome = built.verify([signed]);
      return outcome.some((a) => a.label.startsWith('B4') && !a.outcome.ok);
    }),
  );

  return rows;
}

function safeRow(name: string, fn: () => boolean): SelfTestRow {
  try {
    const ok = fn();
    return { name, ok, detail: ok ? 'pass' : 'assertion failed' };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// --- local signing helpers ---------------------------------------------------

function validPriv(): Uint8Array {
  for (let i = 0; i < 16; i++) {
    const d = crypto.getRandomValues(new Uint8Array(32));
    if (ecc.isPrivate(d)) return d;
  }
  throw new Error('could not generate a private key');
}

function compressed(priv: Uint8Array): Uint8Array {
  const p = ecc.pointFromScalar(priv, true);
  if (!p) throw new Error('invalid private key');
  return p;
}

/** BIP341 key-path private-key tweak (negate for odd-Y internal key, then add the taptweak). */
function tweakPriv(priv: Uint8Array, merkleRoot?: Uint8Array): Uint8Array {
  const p = compressed(priv);
  const d = p[0] === 0x03 ? ecc.privateNegate(priv) : priv;
  const xonly = p.subarray(1, 33);
  const tweak = taggedHash('TapTweak', merkleRoot ? concatBytes(xonly, merkleRoot) : xonly);
  const out = ecc.privateAdd(d, tweak);
  if (!out) throw new Error('tweak produced an invalid key');
  return out;
}

function schnorrWithType(sighash: Uint8Array, priv: Uint8Array, type: number): Uint8Array {
  const sig = ecc.signSchnorr(sighash, priv);
  return type === 0x00 ? sig : concatBytes(sig, Uint8Array.of(type));
}

function p2wpkhScriptCode(compressedPubkey: Uint8Array): Uint8Array {
  const hash = bitcoin.crypto.hash160(compressedPubkey);
  return bitcoin.script.compile([
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    hash,
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG,
  ]);
}

function flipByte(b: Uint8Array, index: number): Uint8Array {
  const out = b.slice();
  out[index] = (out[index] ?? 0) ^ 0xff;
  return out;
}

/** Minimal DER encoder for a 64-byte compact (r||s) ECDSA signature. */
function encodeDer(compact: Uint8Array): Uint8Array {
  const r = trimInt(compact.subarray(0, 32));
  const s = trimInt(compact.subarray(32, 64));
  const body = concatBytes(Uint8Array.of(0x02, r.length), r, Uint8Array.of(0x02, s.length), s);
  return concatBytes(Uint8Array.of(0x30, body.length), body);
}

/** DER integer: strip leading zeros, then re-add one if the high bit would imply a negative. */
function trimInt(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00) start++;
  const trimmed = bytes.subarray(start);
  if ((trimmed[0] ?? 0) & 0x80) return concatBytes(Uint8Array.of(0x00), trimmed);
  return trimmed;
}
