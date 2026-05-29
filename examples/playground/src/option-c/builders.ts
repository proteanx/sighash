import { bitcoin, bytesToHex, hexToBytes, toXOnly } from './crypto';
import type { Passthrough } from './passthrough';
import {
  type VerifyOutcome,
  compareStructure,
  inputIsSigned,
  verifySegwitSig,
  verifyTapKeySig,
  verifyTapScriptSig,
} from './verify';

export const SIGHASH_DEFAULT = 0x00;
export const SIGHASH_ALL = 0x01;
export const SIGHASH_SINGLE_ACP = 0x83;

/** Full inscription postage (V0). Option C keeps this — no shrink. */
const POSTAGE = 546n;
const DUMMY_VALUE = 600n;
const PAYMENT_VALUE = 25_000n;
/** A well-formed outpoint that does not (and will never) exist on-chain. */
const PHANTOM_TXID = 'ff'.repeat(32);

export type PaymentKind = 'p2tr' | 'p2wpkh' | 'p2sh-p2wpkh' | 'unknown';

export function detectPaymentKind(address: string): PaymentKind {
  if (/^(bc1p|tb1p|bcrt1p)/.test(address)) return 'p2tr';
  if (/^(bc1q|tb1q|bcrt1q)/.test(address)) return 'p2wpkh';
  if (/^[23]/.test(address)) return 'p2sh-p2wpkh';
  return 'unknown';
}

/** Everything the builders need about the connected wallet + the passthrough under test. */
export interface BuildCtx {
  network: bitcoin.Network;
  passthrough: Passthrough;
  ordinalsAddress: string;
  ordinalsXOnly: Uint8Array;
  ordinalsPublicKeyHex: string;
  ordinalsSPK: Uint8Array;
  paymentAddress: string;
  paymentPublicKeyHex: string;
  paymentSPK: Uint8Array;
  paymentKind: PaymentKind;
  /** Optional real funded UTXO to exercise the "real prevout" path (B1b, B2). */
  realPrevout?: { txid: string; vout: number; valueSats: number };
}

/** Per-input instruction handed to the wallet signer. */
export interface InputSignSpec {
  index: number;
  address: string;
  publicKeyHex: string;
  sighashTypes: number[];
  /** Script-path legs need the untweaked key (true); key-path BIP86/merkle spends tweak (false). */
  disableTweakSigner?: boolean;
  /**
   * Leaf hash (hex) for script-path inputs. OKX's `signPsbt` exposes a `tapLeafHashToSign`
   * field that binds the signature to a specific leaf; we pass it for OKX to test whether it
   * fixes OKX's SINGLE|ACP tapscript signing (other wallets infer the leaf and ignore this).
   */
  tapLeafHashHex?: string;
}

export interface Assertion {
  label: string;
  outcome: VerifyOutcome;
}

export interface BuiltTest {
  /** One PSBT for single-sign tests; several for batch tests (B5). */
  psbts: string[];
  /** Per-PSBT sign instructions, parallel to {@link psbts}. */
  signSpecs: InputSignSpec[][];
  /** Runs the crypto + fidelity assertions over the wallet's signed result(s). */
  verify: (signed: string[]) => Assertion[];
}

function newPsbt(ctx: BuildCtx, version: number): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: ctx.network });
  psbt.setVersion(version);
  return psbt;
}

type PsbtInputArg = Parameters<bitcoin.Psbt['addInput']>[0];

/**
 * Sets `sighashType` only when it's non-default. bip174 v3 treats `sighashType: 0`
 * (SIGHASH_DEFAULT) as "no data" and throws "Can not add duplicate data to input", so
 * DEFAULT must be expressed by omitting the field — the wallet signs DEFAULT implicitly.
 */
function withSighash(input: PsbtInputArg, sighashType: number): PsbtInputArg {
  if (sighashType !== SIGHASH_DEFAULT) input.sighashType = sighashType;
  return input;
}

/** Resolves the inscription/seller outpoint: the real funded UTXO if supplied, else phantom. */
function sellerOutpoint(ctx: BuildCtx): { hash: string; index: number; value: bigint } {
  if (ctx.realPrevout) {
    return {
      hash: ctx.realPrevout.txid,
      index: ctx.realPrevout.vout,
      value: BigInt(ctx.realPrevout.valueSats),
    };
  }
  return { hash: PHANTOM_TXID, index: 0, value: POSTAGE };
}

function tapLeafScriptEntry(passthrough: Passthrough) {
  return [
    {
      leafVersion: 0xc0,
      script: passthrough.leafScript,
      controlBlock: passthrough.controlBlock,
    },
  ];
}

/** The seller's ordinals output key (BIP86 tweak) committed in the ordinals scriptPubKey. */
function ordinalsOutputKey(ctx: BuildCtx): Uint8Array {
  return ctx.ordinalsSPK.subarray(2);
}

/** A buyer payment input matching the connected wallet's payment-address type. */
function addBuyerPaymentInput(
  ctx: BuildCtx,
  psbt: bitcoin.Psbt,
  hash: string,
  index: number,
  value: bigint,
): void {
  const sighashType = ctx.paymentKind === 'p2tr' ? SIGHASH_DEFAULT : SIGHASH_ALL;
  const input: PsbtInputArg = {
    hash,
    index,
    witnessUtxo: { script: ctx.paymentSPK, value },
  };
  if (ctx.paymentKind === 'p2tr') {
    input.tapInternalKey = toXOnly(hexToBytes(ctx.paymentPublicKeyHex));
  } else if (ctx.paymentKind === 'p2sh-p2wpkh') {
    // Nested segwit: the redeemScript is the P2WPKH program OP_0 <hash160(pubkey)>.
    const pubkeyHash = bitcoin.crypto.hash160(hexToBytes(ctx.paymentPublicKeyHex));
    input.redeemScript = bitcoin.script.compile([bitcoin.opcodes.OP_0, pubkeyHash]);
  }
  psbt.addInput(withSighash(input, sighashType));
}

function buyerSighash(ctx: BuildCtx): number {
  return ctx.paymentKind === 'p2tr' ? SIGHASH_DEFAULT : SIGHASH_ALL;
}

function verifyBuyerInput(ctx: BuildCtx, psbt: bitcoin.Psbt, index: number): VerifyOutcome {
  if (ctx.paymentKind === 'p2tr') {
    return verifyTapKeySig(psbt, index, ctx.paymentSPK.subarray(2), SIGHASH_DEFAULT);
  }
  return verifySegwitSig(psbt, index, SIGHASH_ALL);
}

// ---------------------------------------------------------------------------
// B1a — key-path sign an nVersion 3 tx (C-ONLY)
// ---------------------------------------------------------------------------
export function buildB1a(ctx: BuildCtx): BuiltTest {
  const psbt = newPsbt(ctx, 3);
  const op = sellerOutpoint(ctx);
  psbt.addInput({
    hash: op.hash,
    index: op.index,
    witnessUtxo: { script: ctx.ordinalsSPK, value: op.value },
    tapInternalKey: ctx.ordinalsXOnly,
  });
  psbt.addOutput({ address: ctx.ordinalsAddress, value: op.value });
  const original = psbt.toBase64();

  return {
    psbts: [original],
    signSpecs: [
      [
        {
          index: 0,
          address: ctx.ordinalsAddress,
          publicKeyHex: ctx.ordinalsPublicKeyHex,
          sighashTypes: [SIGHASH_DEFAULT],
          disableTweakSigner: false,
        },
      ],
    ],
    verify: (signed) => {
      const out = bitcoin.Psbt.fromBase64(requireOne(signed), { network: ctx.network });
      return [
        {
          label: 'tapKeySig valid over v3 tx',
          outcome: verifyTapKeySig(out, 0, ordinalsOutputKey(ctx), SIGHASH_DEFAULT),
        },
        structureAssertion(original, requireOne(signed), 3),
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// B1b–B1d — script-path multi_a ladder (SHARED)
// ---------------------------------------------------------------------------
function buildScriptPathLeg(
  ctx: BuildCtx,
  opts: { version: number; sighashType: number; forcePhantom: boolean },
): BuiltTest {
  const psbt = newPsbt(ctx, opts.version);
  const op = opts.forcePhantom
    ? { hash: PHANTOM_TXID, index: 0, value: POSTAGE }
    : sellerOutpoint(ctx);
  psbt.addInput(
    withSighash(
      {
        hash: op.hash,
        index: op.index,
        witnessUtxo: { script: ctx.passthrough.scriptPubKey, value: op.value },
        tapLeafScript: tapLeafScriptEntry(ctx.passthrough),
      },
      opts.sighashType,
    ),
  );
  // Output at the same index as the input so SINGLE|ACP has a committed output.
  psbt.addOutput({ address: ctx.ordinalsAddress, value: op.value });
  const original = psbt.toBase64();

  return {
    psbts: [original],
    signSpecs: [
      [
        {
          index: 0,
          address: ctx.ordinalsAddress,
          publicKeyHex: ctx.ordinalsPublicKeyHex,
          sighashTypes: [opts.sighashType],
          disableTweakSigner: true,
          tapLeafHashHex: bytesToHex(ctx.passthrough.leafHash),
        },
      ],
    ],
    verify: (signed) => {
      const out = bitcoin.Psbt.fromBase64(requireOne(signed), { network: ctx.network });
      return [
        {
          label: 'multi_a tapScriptSig (seller leg) valid',
          outcome: verifyTapScriptSig(
            out,
            0,
            ctx.passthrough.sellerXOnly,
            ctx.passthrough.leafHash,
            opts.sighashType,
          ),
        },
        structureAssertion(original, requireOne(signed), opts.version),
      ];
    },
  };
}

export function buildB1b(ctx: BuildCtx): BuiltTest {
  return buildScriptPathLeg(ctx, { version: 2, sighashType: SIGHASH_DEFAULT, forcePhantom: false });
}

export function buildB1c(ctx: BuildCtx): BuiltTest {
  return buildScriptPathLeg(ctx, {
    version: 2,
    sighashType: SIGHASH_SINGLE_ACP,
    forcePhantom: false,
  });
}

export function buildB1d(ctx: BuildCtx): BuiltTest {
  return buildScriptPathLeg(ctx, {
    version: 2,
    sighashType: SIGHASH_SINGLE_ACP,
    forcePhantom: true,
  });
}

// ---------------------------------------------------------------------------
// B1e — combined seller TX2-leg (v3, script-path, SINGLE|ACP, phantom) + A4 transplant
// ---------------------------------------------------------------------------
export function buildB1e(ctx: BuildCtx): BuiltTest {
  // Minimal 1-in-1-out template: passthrough input at index 0 → seller payout at output 0.
  const template = newPsbt(ctx, 3);
  template.addInput({
    hash: PHANTOM_TXID,
    index: 0,
    witnessUtxo: { script: ctx.passthrough.scriptPubKey, value: POSTAGE },
    tapLeafScript: tapLeafScriptEntry(ctx.passthrough),
    sighashType: SIGHASH_SINGLE_ACP,
  });
  template.addOutput({ address: ctx.ordinalsAddress, value: POSTAGE });
  const original = template.toBase64();

  return {
    psbts: [original],
    signSpecs: [
      [
        {
          index: 0,
          address: ctx.ordinalsAddress,
          publicKeyHex: ctx.ordinalsPublicKeyHex,
          sighashTypes: [SIGHASH_SINGLE_ACP],
          disableTweakSigner: true,
          tapLeafHashHex: bytesToHex(ctx.passthrough.leafHash),
        },
      ],
    ],
    verify: (signed) => {
      const signedTemplate = bitcoin.Psbt.fromBase64(requireOne(signed), { network: ctx.network });
      const templateOutcome = verifyTapScriptSig(
        signedTemplate,
        0,
        ctx.passthrough.sellerXOnly,
        ctx.passthrough.leafHash,
        SIGHASH_SINGLE_ACP,
      );

      // A4 transplant: place the template's input/output (byte-identical) at index 2 of a full
      // TX2 and confirm the SAME signature still validates — SINGLE|ACP commits only to its own
      // input and the output at the matching index.
      const entry = signedTemplate.data.inputs[0]?.tapScriptSig?.find(
        (s) => s.leafHash.length === 32,
      );
      let transplantOutcome: VerifyOutcome;
      if (!entry) {
        transplantOutcome = { ok: false, reason: 'No tapScriptSig to transplant' };
      } else {
        const full = buildFullTx2Skeleton(ctx);
        const target = full.data.inputs[2];
        if (target) target.tapScriptSig = [entry];
        transplantOutcome = verifyTapScriptSig(
          full,
          2,
          ctx.passthrough.sellerXOnly,
          ctx.passthrough.leafHash,
          SIGHASH_SINGLE_ACP,
        );
      }

      return [
        { label: 'seller leg valid on 1-in-1-out template', outcome: templateOutcome },
        { label: 'A4: same sig validates transplanted to TX2 input 2', outcome: transplantOutcome },
        structureAssertion(original, requireOne(signed), 3),
      ];
    },
  };
}

/**
 * Full TX2 skeleton matching the design's index layout, used by the B1e transplant check.
 * Input 2 / output 2 are byte-identical to the B1e template (same outpoint, value, script);
 * the surrounding buyer dummies/payouts are filler the SINGLE|ACP sighash never commits to.
 */
function buildFullTx2Skeleton(ctx: BuildCtx): bitcoin.Psbt {
  const psbt = newPsbt(ctx, 3);
  // Inputs 0,1: buyer dummies (filler — value/script irrelevant to the ACP sighash at index 2).
  psbt.addInput({
    hash: PHANTOM_TXID,
    index: 10,
    witnessUtxo: { script: ctx.ordinalsSPK, value: DUMMY_VALUE },
  });
  psbt.addInput({
    hash: PHANTOM_TXID,
    index: 11,
    witnessUtxo: { script: ctx.ordinalsSPK, value: DUMMY_VALUE },
  });
  // Input 2: the passthrough — identical to the template's input 0.
  psbt.addInput({
    hash: PHANTOM_TXID,
    index: 0,
    witnessUtxo: { script: ctx.passthrough.scriptPubKey, value: POSTAGE },
    tapLeafScript: tapLeafScriptEntry(ctx.passthrough),
    sighashType: SIGHASH_SINGLE_ACP,
  });
  // Input 3: buyer payment (filler).
  psbt.addInput({
    hash: PHANTOM_TXID,
    index: 12,
    witnessUtxo: { script: ctx.ordinalsSPK, value: PAYMENT_VALUE },
  });
  // Outputs 0,1: buyer consolidation + inscription (filler).
  psbt.addOutput({ address: ctx.ordinalsAddress, value: DUMMY_VALUE });
  psbt.addOutput({ address: ctx.ordinalsAddress, value: POSTAGE });
  // Output 2: seller payout — identical to the template's output 0.
  psbt.addOutput({ address: ctx.ordinalsAddress, value: POSTAGE });
  // Output 3: marketplace fee (filler).
  psbt.addOutput({ address: ctx.ordinalsAddress, value: DUMMY_VALUE });
  return psbt;
}

// ---------------------------------------------------------------------------
// B2 — seller signs TX1 (inscription → passthrough), v3, key-path DEFAULT, 0 fee
// ---------------------------------------------------------------------------
export function buildB2(ctx: BuildCtx): BuiltTest {
  const psbt = newPsbt(ctx, 3);
  const op = sellerOutpoint(ctx);
  psbt.addInput({
    hash: op.hash,
    index: op.index,
    witnessUtxo: { script: ctx.ordinalsSPK, value: op.value },
    tapInternalKey: ctx.ordinalsXOnly,
  });
  // 0 fee: the whole input value flows to the passthrough output (full postage preserved).
  psbt.addOutput({ address: ctx.passthrough.address, value: op.value });
  const original = psbt.toBase64();

  return {
    psbts: [original],
    signSpecs: [
      [
        {
          index: 0,
          address: ctx.ordinalsAddress,
          publicKeyHex: ctx.ordinalsPublicKeyHex,
          sighashTypes: [SIGHASH_DEFAULT],
          disableTweakSigner: false,
        },
      ],
    ],
    verify: (signed) => {
      const out = bitcoin.Psbt.fromBase64(requireOne(signed), { network: ctx.network });
      return [
        {
          label: 'tapKeySig valid (inscription → passthrough)',
          outcome: verifyTapKeySig(out, 0, ordinalsOutputKey(ctx), SIGHASH_DEFAULT),
        },
        structureAssertion(original, requireOne(signed), 3),
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// B3 — buyer signs ONLY its own inputs of a mixed TX2 (SHARED)
// ---------------------------------------------------------------------------
export function buildB3(ctx: BuildCtx): BuiltTest {
  const psbt = newPsbt(ctx, 3);
  const buyerIndexes = [0, 1, 3];
  // Inputs 0,1: buyer dummies.
  addBuyerPaymentInput(ctx, psbt, PHANTOM_TXID, 20, DUMMY_VALUE);
  addBuyerPaymentInput(ctx, psbt, PHANTOM_TXID, 21, DUMMY_VALUE);
  // Input 2: the passthrough multi_a leg the buyer MUST NOT touch.
  psbt.addInput({
    hash: PHANTOM_TXID,
    index: 0,
    witnessUtxo: { script: ctx.passthrough.scriptPubKey, value: POSTAGE },
    tapLeafScript: tapLeafScriptEntry(ctx.passthrough),
    sighashType: SIGHASH_SINGLE_ACP,
  });
  // Input 3: buyer payment.
  addBuyerPaymentInput(ctx, psbt, PHANTOM_TXID, 22, PAYMENT_VALUE);
  // Outputs: consolidation, inscription receive, seller payout, fee.
  psbt.addOutput({ address: ctx.paymentAddress, value: DUMMY_VALUE * 2n });
  psbt.addOutput({ address: ctx.ordinalsAddress, value: POSTAGE });
  psbt.addOutput({ address: ctx.ordinalsAddress, value: POSTAGE });
  psbt.addOutput({ address: ctx.paymentAddress, value: 5_000n });
  const original = psbt.toBase64();

  const sh = buyerSighash(ctx);
  return {
    psbts: [original],
    signSpecs: [
      buyerIndexes.map((index) => ({
        index,
        address: ctx.paymentAddress,
        publicKeyHex: ctx.paymentPublicKeyHex,
        sighashTypes: [sh],
        disableTweakSigner: false,
      })),
    ],
    verify: (signed) => {
      const out = bitcoin.Psbt.fromBase64(requireOne(signed), { network: ctx.network });
      const assertions: Assertion[] = buyerIndexes.map((index) => ({
        label: `buyer input ${index} signed (${ctx.paymentKind})`,
        outcome: verifyBuyerInput(ctx, out, index),
      }));
      // The critical gate: the wallet left the multi_a passthrough input untouched.
      const passthroughUntouched = !inputIsSigned(out, 2);
      assertions.push({
        label: 'passthrough input 2 left untouched by buyer',
        outcome: {
          ok: passthroughUntouched,
          reason: passthroughUntouched
            ? 'Buyer added no signature to the multi_a input'
            : 'Buyer wrongly signed the multi_a passthrough input',
        },
      });
      assertions.push(structureAssertion(original, requireOne(signed), 3));
      return assertions;
    },
  };
}

// ---------------------------------------------------------------------------
// B5a — sweep buyer batch sign N v3 TX2s (C-ONLY)
// ---------------------------------------------------------------------------
export function buildB5aSweep(ctx: BuildCtx, count: number): BuiltTest {
  const sh = buyerSighash(ctx);
  const originals: string[] = [];
  for (let n = 0; n < count; n++) {
    const psbt = newPsbt(ctx, 3);
    // Distinct outpoints per package so the N PSBTs are genuinely independent.
    addBuyerPaymentInput(ctx, psbt, PHANTOM_TXID, 100 + n, PAYMENT_VALUE);
    psbt.addInput({
      hash: PHANTOM_TXID,
      index: n,
      witnessUtxo: { script: ctx.passthrough.scriptPubKey, value: POSTAGE },
      tapLeafScript: tapLeafScriptEntry(ctx.passthrough),
      sighashType: SIGHASH_SINGLE_ACP,
    });
    psbt.addOutput({ address: ctx.ordinalsAddress, value: POSTAGE });
    psbt.addOutput({ address: ctx.paymentAddress, value: 5_000n });
    originals.push(psbt.toBase64());
  }

  // Flat spec (same buyer index 0 in every PSBT) so the wallet's native bulk RPC can apply it.
  const signSpecs = originals.map(() => [
    {
      index: 0,
      address: ctx.paymentAddress,
      publicKeyHex: ctx.paymentPublicKeyHex,
      sighashTypes: [sh],
      disableTweakSigner: false,
    },
  ]);

  return {
    psbts: originals,
    signSpecs,
    verify: (signed) => {
      const assertions: Assertion[] = [];
      for (let n = 0; n < originals.length; n++) {
        const signedN = signed[n];
        const originalN = originals[n];
        if (!signedN || !originalN) {
          assertions.push({
            label: `package ${n} returned`,
            outcome: { ok: false, reason: 'Missing signed PSBT' },
          });
          continue;
        }
        const out = bitcoin.Psbt.fromBase64(signedN, { network: ctx.network });
        assertions.push({
          label: `package ${n}: buyer input signed`,
          outcome: verifyBuyerInput(ctx, out, 0),
        });
        assertions.push({
          label: `package ${n}: passthrough untouched`,
          outcome: {
            ok: !inputIsSigned(out, 1),
            reason: inputIsSigned(out, 1)
              ? 'Buyer signed the multi_a input'
              : 'multi_a input untouched',
          },
        });
      }
      return assertions;
    },
  };
}

// ---------------------------------------------------------------------------
// B5b — seller batch: TX1 (key-path) + TX2 template (script-path) in one approval (SHARED)
// ---------------------------------------------------------------------------
export function buildB5bSellerBatch(ctx: BuildCtx): BuiltTest {
  const b2 = buildB2(ctx);
  const b1e = buildB1e(ctx);
  const tx1 = requireOne(b2.psbts);
  const tx2 = requireOne(b1e.psbts);

  return {
    psbts: [tx1, tx2],
    // Per-PSBT specs differ (key-path vs script-path) → forces sequential on UniSat/OKX
    // (acceptable per the handoff), handled natively per-PSBT by Xverse.
    signSpecs: [requireOne(b2.signSpecs), requireOne(b1e.signSpecs)],
    verify: (signed) => {
      const tx1Signed = signed[0];
      const tx2Signed = signed[1];
      const assertions: Assertion[] = [];
      assertions.push(
        ...(tx1Signed
          ? b2.verify([tx1Signed]).map((a) => ({ ...a, label: `TX1 · ${a.label}` }))
          : [{ label: 'TX1 returned', outcome: { ok: false, reason: 'Missing signed TX1' } }]),
      );
      assertions.push(
        ...(tx2Signed
          ? b1e.verify([tx2Signed]).map((a) => ({ ...a, label: `TX2 · ${a.label}` }))
          : [{ label: 'TX2 returned', outcome: { ok: false, reason: 'Missing signed TX2' } }]),
      );
      return assertions;
    },
  };
}

// ---------------------------------------------------------------------------
// B6 — recovery: key-path spend of the passthrough (non-BIP86 merkle tweak) (C-ONLY)
// ---------------------------------------------------------------------------
export function buildB6(ctx: BuildCtx): BuiltTest {
  const psbt = newPsbt(ctx, 2);
  psbt.addInput({
    hash: PHANTOM_TXID,
    index: 0,
    witnessUtxo: { script: ctx.passthrough.scriptPubKey, value: POSTAGE },
    tapInternalKey: ctx.passthrough.sellerXOnly,
    tapMerkleRoot: ctx.passthrough.merkleRoot,
  });
  psbt.addOutput({ address: ctx.ordinalsAddress, value: POSTAGE });
  const original = psbt.toBase64();

  return {
    psbts: [original],
    signSpecs: [
      [
        {
          index: 0,
          address: ctx.ordinalsAddress,
          publicKeyHex: ctx.ordinalsPublicKeyHex,
          sighashTypes: [SIGHASH_DEFAULT],
          disableTweakSigner: false,
        },
      ],
    ],
    verify: (signed) => {
      const out = bitcoin.Psbt.fromBase64(requireOne(signed), { network: ctx.network });
      // The wallet must apply the merkle-root tweak: a BIP86-only signer produces a sig that
      // verifies against the wrong key, failing here. That's the gate (non-fatal).
      return [
        {
          label: 'tapKeySig valid over merkle-tweaked passthrough key',
          outcome: verifyTapKeySig(out, 0, ctx.passthrough.outputKey, SIGHASH_DEFAULT),
        },
        structureAssertion(original, requireOne(signed), 2),
      ];
    },
  };
}

function structureAssertion(original: string, signed: string, expectedVersion: number): Assertion {
  const diffs = compareStructure(original, signed);
  const out = bitcoin.Psbt.fromBase64(signed);
  const versionOk = out.version === expectedVersion;
  const ok = diffs.length === 0 && versionOk;
  const reasonParts: string[] = [];
  if (!versionOk) reasonParts.push(`nVersion is ${out.version}, expected ${expectedVersion}`);
  if (diffs.length > 0) reasonParts.push(`mutations: ${diffs.join('; ')}`);
  return {
    label: 'B4 fidelity: structure unmutated + version preserved',
    outcome: {
      ok,
      reason: ok ? 'Only witness/sig fields added; nVersion preserved' : reasonParts.join(' · '),
    },
  };
}

function requireOne<T>(arr: T[]): T {
  const first = arr[0];
  if (first === undefined) throw new Error('Expected at least one PSBT');
  return first;
}
