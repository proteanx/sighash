import { type InputToSign, type SighashClient, hexToBase64 } from '@sighash-dev/core';
import type { InputSignSpec } from './builders';

/**
 * The harness drives signing entirely through the sighash client — the same path ARKAiD
 * uses. Script-path control (`disableTweakSigner`, `tapLeafHashToSign`) rides on the
 * canonical {@link InputToSign}; the client dispatches to whichever wallet is connected and
 * each provider maps the fields onto its own RPC (UniSat/OKX honor them; Xverse infers
 * key- vs script-path from the PSBT and ignores them).
 */
export interface SignerDeps {
  client: SighashClient;
}

export interface BatchSignResult {
  signed: string[];
  /** Whether one wallet approval covered the whole batch ('native') or it was N prompts. */
  signingPath: 'native' | 'sequential';
}

function toCoreInputs(specs: InputSignSpec[]): InputToSign[] {
  return specs.map((s) => {
    const out: InputToSign = {
      index: s.index,
      address: s.address,
      publicKey: s.publicKeyHex,
      sighashTypes: s.sighashTypes,
    };
    if (s.disableTweakSigner !== undefined) out.disableTweakSigner = s.disableTweakSigner;
    if (s.tapLeafHashHex !== undefined) out.tapLeafHashToSign = s.tapLeafHashHex;
    return out;
  });
}

/** Signs one PSBT through the connected wallet, returning the signed PSBT as base64. */
export async function signOne(
  deps: SignerDeps,
  psbtBase64: string,
  specs: InputSignSpec[],
): Promise<string> {
  const res = await deps.client.signPsbt({
    tx: psbtBase64,
    inputsToSign: toCoreInputs(specs),
    finalize: false,
    broadcast: false,
  });
  return requireSignedBase64(res.signedPsbtBase64, res.signedPsbtHex);
}

/** Signs N PSBTs through the connected wallet, reporting whether one approval covered them. */
export async function signMany(
  deps: SignerDeps,
  psbts: string[],
  specs: InputSignSpec[][],
): Promise<BatchSignResult> {
  const res = await deps.client.signPsbts({
    psbts,
    // Per-PSBT inputs: a flat list when every PSBT signs the same way, nested otherwise. We
    // always pass nested and let the provider collapse it (UniSat/OKX go sequential for
    // heterogeneous batches like B5b; Xverse handles per-PSBT natively).
    inputsToSign: specs.map(toCoreInputs),
    finalize: false,
    broadcast: false,
  });
  return {
    signed: res.signedPsbts.map((s) => requireSignedBase64(s.signedPsbtBase64, s.signedPsbtHex)),
    signingPath: res.signingPath,
  };
}

function requireSignedBase64(base64?: string, hex?: string): string {
  if (base64) return base64;
  if (hex) return hexToBase64(hex);
  throw new Error('Wallet returned no signed PSBT');
}
