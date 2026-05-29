import {
  bitcoin,
  bytesEqual,
  bytesToHex,
  compactSize,
  concatBytes,
  ecc,
  taggedHash,
} from './crypto';

/** Tapscript leaf version for `multi_a` (BIP342 default leaf version). */
export const LEAF_VERSION = 0xc0;

/**
 * Builds the `multi_a(2, A, B)` leaf script from Appendix A:
 *
 *   20 <A:32> ac 20 <B:32> ba 52 9c
 *   push32  A  OP_CHECKSIG  push32  B  OP_CHECKSIGADD  OP_2  OP_NUMEQUAL
 *
 * `A` (seller) is checked first by OP_CHECKSIG, so its signature sits on top of the
 * witness stack; `B` (platform) is accumulated by OP_CHECKSIGADD.
 */
export function multiAScript(sellerXOnly: Uint8Array, platformXOnly: Uint8Array): Uint8Array {
  if (sellerXOnly.length !== 32 || platformXOnly.length !== 32) {
    throw new Error('multi_a legs must be 32-byte x-only keys');
  }
  const script = bitcoin.script.compile([
    sellerXOnly,
    bitcoin.opcodes.OP_CHECKSIG,
    platformXOnly,
    bitcoin.opcodes.OP_CHECKSIGADD,
    bitcoin.opcodes.OP_2,
    bitcoin.opcodes.OP_NUMEQUAL,
  ]);
  if (script.length !== 70) {
    throw new Error(`Expected a 70-byte multi_a script, got ${script.length}`);
  }
  return script;
}

/** TapLeaf hash = taggedHash("TapLeaf", leafVersion || compactSize(len) || script). */
export function tapLeafHash(script: Uint8Array): Uint8Array {
  return taggedHash(
    'TapLeaf',
    concatBytes(Uint8Array.of(LEAF_VERSION), compactSize(script.length), script),
  );
}

export interface Passthrough {
  /** `seller_xonly` — the connected wallet's ordinals key; internal key + multi_a leg. */
  sellerXOnly: Uint8Array;
  /** `platform_xonly` — throwaway test key; the server-side multi_a leg. */
  platformXOnly: Uint8Array;
  /** 70-byte `multi_a(2, seller, platform)` leaf script. */
  leafScript: Uint8Array;
  /** Single-leaf TapLeaf hash; also the merkle root. */
  leafHash: Uint8Array;
  /** Equal to `leafHash` for a single-leaf tree — passed as `tapMerkleRoot` for recovery. */
  merkleRoot: Uint8Array;
  /** Tweaked output key Q (x-only) committed in the scriptPubKey. */
  outputKey: Uint8Array;
  /** Parity of Q, encoded into the control block. */
  parity: 0 | 1;
  /** `51 20 <Q>` — the passthrough output's scriptPubKey. */
  scriptPubKey: Uint8Array;
  /** Control block for the single-leaf script path: `(0xc0 | parity) || seller_xonly`. */
  controlBlock: Uint8Array;
  /** Bech32m address of the passthrough output. */
  address: string;
}

/**
 * Constructs the Option C passthrough `tr(seller, { multi_a(2, seller, platform) })` and
 * derives every field a wallet/PSBT/verifier needs (Appendix A). Cross-checks the manual
 * derivation against bitcoinjs-lib's `payments.p2tr` and throws on any mismatch — this is
 * the A1 self-test, run every time the passthrough is built.
 */
export function buildPassthrough(
  sellerXOnly: Uint8Array,
  platformXOnly: Uint8Array,
  network: bitcoin.Network,
): Passthrough {
  const leafScript = multiAScript(sellerXOnly, platformXOnly);
  const leafHash = tapLeafHash(leafScript);
  const merkleRoot = leafHash;

  const tweak = taggedHash('TapTweak', concatBytes(sellerXOnly, merkleRoot));
  const tweaked = ecc.xOnlyPointAddTweak(sellerXOnly, tweak);
  if (!tweaked) {
    throw new Error('xOnlyPointAddTweak returned null — degenerate key, regenerate platform key');
  }
  const outputKey = tweaked.xOnlyPubkey;
  const parity = tweaked.parity;

  const scriptPubKey = concatBytes(Uint8Array.of(0x51, 0x20), outputKey);
  const controlBlock = concatBytes(Uint8Array.of(LEAF_VERSION | parity), sellerXOnly);
  const address = bitcoin.address.fromOutputScript(scriptPubKey, network);

  assertMatchesBitcoinjs({ leafScript, scriptPubKey, controlBlock, address }, sellerXOnly, network);

  return {
    sellerXOnly,
    platformXOnly,
    leafScript,
    leafHash,
    merkleRoot,
    outputKey,
    parity,
    scriptPubKey,
    controlBlock,
    address,
  };
}

function assertMatchesBitcoinjs(
  manual: {
    leafScript: Uint8Array;
    scriptPubKey: Uint8Array;
    controlBlock: Uint8Array;
    address: string;
  },
  sellerXOnly: Uint8Array,
  network: bitcoin.Network,
): void {
  const p2tr = bitcoin.payments.p2tr({
    internalPubkey: sellerXOnly,
    scriptTree: { output: manual.leafScript },
    redeem: { output: manual.leafScript, redeemVersion: LEAF_VERSION },
    network,
  });

  if (!p2tr.output || !bytesEqual(p2tr.output, manual.scriptPubKey)) {
    throw new Error(
      `Passthrough scriptPubKey mismatch vs bitcoinjs: manual=${bytesToHex(manual.scriptPubKey)} p2tr=${p2tr.output ? bytesToHex(p2tr.output) : 'undefined'}`,
    );
  }
  if (p2tr.address !== manual.address) {
    throw new Error(`Passthrough address mismatch: manual=${manual.address} p2tr=${p2tr.address}`);
  }
  const witness = p2tr.witness ?? [];
  const p2trControl = witness[witness.length - 1];
  if (!p2trControl || !bytesEqual(p2trControl, manual.controlBlock)) {
    throw new Error('Passthrough control block mismatch vs bitcoinjs p2tr witness');
  }
}
