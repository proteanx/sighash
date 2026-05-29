import { type NetworkType, getBitcoinJsNetwork } from '@sighash-dev/core';
import {
  type Assertion,
  type BuildCtx,
  type BuiltTest,
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
  detectPaymentKind,
} from './builders';
import { bitcoin, hexToBytes, toXOnly } from './crypto';
import { buildPassthrough } from './passthrough';
import { type SignerDeps, signMany, signOne } from './signers';

/** Two-level gate from the handoff doc: SHARED gates block any design; C-ONLY block only Option C. */
export type Gate = 'SHARED' | 'C-ONLY' | 'SHARED+C';

export interface TrackBTest {
  id: string;
  label: string;
  gate: Gate;
  /** The single most important early result — script-path multi_a signing. */
  masterGate?: boolean;
  /** A failure here is recorded but doesn't sink Option C (e.g. recovery falls back to script-path). */
  nonFatal?: boolean;
  build: (ctx: BuildCtx) => BuiltTest;
}

/**
 * Track B test registry. B4 (fidelity) is folded into every test as the trailing structure
 * assertion rather than a standalone row — the handoff treats it as cross-cutting.
 */
export const TRACK_B_TESTS: TrackBTest[] = [
  {
    id: 'KP-ACP',
    label: 'key-path SINGLE|ACP (legacy listing baseline)',
    gate: 'SHARED',
    build: buildKeyPathAcp,
  },
  { id: 'B1a', label: 'v3 key-path', gate: 'C-ONLY', build: buildB1a },
  { id: 'B1b', label: 'script-path multi_a', gate: 'SHARED', masterGate: true, build: buildB1b },
  { id: 'B1c', label: '+ SINGLE|ACP (0x83)', gate: 'SHARED', build: buildB1c },
  { id: 'B1d', label: '+ phantom prevout', gate: 'SHARED', build: buildB1d },
  { id: 'B1e', label: 'combined seller leg + transplant', gate: 'SHARED+C', build: buildB1e },
  { id: 'B2', label: 'TX1 inscription → passthrough', gate: 'SHARED', build: buildB2 },
  { id: 'B3', label: 'buyer partial sign', gate: 'SHARED', build: buildB3 },
  { id: 'B5a-3', label: 'sweep batch N=3', gate: 'C-ONLY', build: (ctx) => buildB5aSweep(ctx, 3) },
  {
    id: 'B5a-10',
    label: 'sweep batch N=10',
    gate: 'C-ONLY',
    build: (ctx) => buildB5aSweep(ctx, 10),
  },
  { id: 'B5b', label: 'seller batch (TX1 + TX2)', gate: 'SHARED', build: buildB5bSellerBatch },
  { id: 'B6', label: 'recovery key-path', gate: 'C-ONLY', nonFatal: true, build: buildB6 },
];

export interface TestRunResult {
  id: string;
  ok: boolean;
  assertions: Assertion[];
  signingPath?: 'native' | 'sequential';
  error?: string;
}

export interface CreateCtxParams {
  network: NetworkType;
  ordinalsAddress: string;
  ordinalsPublicKeyHex: string;
  paymentAddress: string;
  paymentPublicKeyHex: string;
  platformXOnly: Uint8Array;
  realPrevout?: { txid: string; vout: number; valueSats: number };
}

/** Assembles the {@link BuildCtx} from the connected wallet's keys + the test platform key. */
export function createBuildCtx(params: CreateCtxParams): BuildCtx {
  const network = getBitcoinJsNetwork(params.network);
  const ordinalsXOnly = toXOnly(hexToBytes(params.ordinalsPublicKeyHex));
  const passthrough = buildPassthrough(ordinalsXOnly, params.platformXOnly, network);
  return {
    network,
    passthrough,
    ordinalsAddress: params.ordinalsAddress,
    ordinalsXOnly,
    ordinalsPublicKeyHex: params.ordinalsPublicKeyHex,
    ordinalsSPK: bitcoin.address.toOutputScript(params.ordinalsAddress, network),
    paymentAddress: params.paymentAddress,
    paymentPublicKeyHex: params.paymentPublicKeyHex,
    paymentSPK: bitcoin.address.toOutputScript(params.paymentAddress, network),
    paymentKind: detectPaymentKind(params.paymentAddress),
    ...(params.realPrevout ? { realPrevout: params.realPrevout } : {}),
  };
}

/** Builds the test PSBT(s), drives the wallet to sign, then verifies. Never throws. */
export async function runTrackBTest(
  test: TrackBTest,
  ctx: BuildCtx,
  deps: SignerDeps,
): Promise<TestRunResult> {
  try {
    const built = test.build(ctx);
    let signed: string[];
    let signingPath: 'native' | 'sequential' | undefined;

    if (built.psbts.length === 1) {
      const psbt = built.psbts[0];
      const spec = built.signSpecs[0];
      if (!psbt || !spec) throw new Error('Builder produced no PSBT/spec');
      signed = [await signOne(deps, psbt, spec)];
    } else {
      const res = await signMany(deps, built.psbts, built.signSpecs);
      signed = res.signed;
      signingPath = res.signingPath;
    }

    const assertions = built.verify(signed);
    const ok = assertions.length > 0 && assertions.every((a) => a.outcome.ok);
    return { id: test.id, ok, assertions, ...(signingPath ? { signingPath } : {}) };
  } catch (err) {
    return {
      id: test.id,
      ok: false,
      assertions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
