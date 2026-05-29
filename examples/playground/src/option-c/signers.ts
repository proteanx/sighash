import {
  type InputToSign,
  MAINNET,
  type NetworkType,
  OKX,
  type OkxLibrary,
  type ProviderType,
  type SighashClient,
  UNISAT,
  type UnisatLibrary,
  XVERSE,
  hexToBase64,
} from '@sighash-dev/core';
import type { InputSignSpec } from './builders';

export interface SignerDeps {
  provider: ProviderType;
  network: NetworkType;
  /** Used only for the Xverse path (the modern signPsbt RPC needs no script-path flags). */
  client: SighashClient;
}

export interface BatchSignResult {
  signed: string[];
  /** Whether one wallet approval covered the whole batch ('native') or it was N prompts. */
  signingPath: 'native' | 'sequential';
}

/** OKX's per-input descriptor — a superset of UniSat's that also honors script-path flags. */
interface OkxToSignInputExt {
  index: number;
  address?: string;
  publicKey?: string;
  sighashTypes?: number[];
  disableTweakSigner?: boolean;
  /** OKX-only: binds a script-path signature to a specific tapleaf (hex). */
  tapLeafHashToSign?: string;
}

interface RawWindow {
  unisat?: UnisatLibrary;
  okxwallet?: { bitcoin?: OkxLibrary; bitcoinTestnet?: OkxLibrary };
}

function rawWindow(): RawWindow {
  return globalThis as unknown as RawWindow;
}

function requireUnisat(): UnisatLibrary {
  const lib = rawWindow().unisat;
  if (!lib) throw new Error('UniSat is not available on window.unisat');
  return lib;
}

function requireOkx(network: NetworkType): OkxLibrary {
  const wallet = rawWindow().okxwallet;
  const lib = network === MAINNET ? wallet?.bitcoin : wallet?.bitcoinTestnet;
  if (!lib) throw new Error(`OKX is not available for network "${network}"`);
  return lib;
}

function toUnisatInputs(specs: InputSignSpec[]) {
  return specs.map((s) => ({
    index: s.index,
    address: s.address,
    publicKey: s.publicKeyHex,
    sighashTypes: s.sighashTypes,
    disableTweakSigner: s.disableTweakSigner,
  }));
}

function toOkxInputs(specs: InputSignSpec[]): OkxToSignInputExt[] {
  return specs.map((s) => {
    const out: OkxToSignInputExt = {
      index: s.index,
      address: s.address,
      publicKey: s.publicKeyHex,
      sighashTypes: s.sighashTypes,
      disableTweakSigner: s.disableTweakSigner,
    };
    if (s.tapLeafHashHex) out.tapLeafHashToSign = s.tapLeafHashHex;
    return out;
  });
}

function toCoreInputs(specs: InputSignSpec[]): InputToSign[] {
  return specs.map((s) => ({
    index: s.index,
    address: s.address,
    publicKey: s.publicKeyHex,
    sighashTypes: s.sighashTypes,
  }));
}

/** Signs one PSBT, returning the signed PSBT as base64. Always partial-sign (no finalize). */
export async function signOne(
  deps: SignerDeps,
  psbtBase64: string,
  specs: InputSignSpec[],
): Promise<string> {
  switch (deps.provider) {
    case UNISAT: {
      const lib = requireUnisat();
      const hex = base64ToHexLocal(psbtBase64);
      const signed = await lib.signPsbt(hex, {
        autoFinalized: false,
        toSignInputs: toUnisatInputs(specs),
      });
      return hexToBase64(signed);
    }
    case OKX: {
      const lib = requireOkx(deps.network);
      const hex = base64ToHexLocal(psbtBase64);
      const signed = await lib.signPsbt(hex, {
        autoFinalized: false,
        toSignInputs: toOkxInputs(specs),
      });
      return hexToBase64(signed);
    }
    case XVERSE: {
      const res = await deps.client.signPsbt({
        tx: psbtBase64,
        inputsToSign: toCoreInputs(specs),
        finalize: false,
        broadcast: false,
      });
      return requireSignedBase64(res.signedPsbtBase64, res.signedPsbtHex);
    }
    default:
      throw new Error(`Unsupported provider: ${deps.provider}`);
  }
}

/** Signs N PSBTs, preferring the wallet's one-approval bulk RPC and reporting the path taken. */
export async function signMany(
  deps: SignerDeps,
  psbts: string[],
  specs: InputSignSpec[][],
): Promise<BatchSignResult> {
  switch (deps.provider) {
    case UNISAT: {
      const lib = requireUnisat();
      // UniSat's bulk RPC applies a single toSignInputs to every PSBT; heterogeneous specs
      // (e.g. B5b's key-path TX1 + script-path TX2) must fall back to a sequential loop.
      if (!specsAreHomogeneous(specs)) {
        return sequential(deps, psbts, specs);
      }
      const hexs = psbts.map(base64ToHexLocal);
      const signed = await lib.signPsbts(hexs, {
        autoFinalized: false,
        toSignInputs: toUnisatInputs(firstSpec(specs)),
      });
      return { signed: signed.map(hexToBase64), signingPath: 'native' };
    }
    case OKX: {
      const lib = requireOkx(deps.network);
      const bulk = lib.signPsbts ?? lib.signMultiplePsbts;
      if (typeof bulk !== 'function') {
        return sequential(deps, psbts, specs);
      }
      const hexs = psbts.map(base64ToHexLocal);
      // OKX takes a per-PSBT options array, so heterogeneous specs work natively.
      const opts = specs.map((s) => ({ autoFinalized: false, toSignInputs: toOkxInputs(s) }));
      const signed = await bulk.call(lib, hexs, opts);
      return { signed: signed.map(hexToBase64), signingPath: 'native' };
    }
    case XVERSE: {
      const res = await deps.client.signPsbts({
        psbts,
        inputsToSign: specs.map(toCoreInputs),
        finalize: false,
        broadcast: false,
      });
      return {
        signed: res.signedPsbts.map((s) =>
          requireSignedBase64(s.signedPsbtBase64, s.signedPsbtHex),
        ),
        signingPath: res.signingPath,
      };
    }
    default:
      throw new Error(`Unsupported provider: ${deps.provider}`);
  }
}

async function sequential(
  deps: SignerDeps,
  psbts: string[],
  specs: InputSignSpec[][],
): Promise<BatchSignResult> {
  const signed: string[] = [];
  for (let i = 0; i < psbts.length; i++) {
    const psbt = psbts[i];
    const spec = specs[i];
    if (!psbt || !spec) throw new Error(`Missing PSBT/spec at index ${i}`);
    signed.push(await signOne(deps, psbt, spec));
  }
  return { signed, signingPath: 'sequential' };
}

function specsAreHomogeneous(specs: InputSignSpec[][]): boolean {
  if (specs.length <= 1) return true;
  const first = JSON.stringify(specs[0]);
  return specs.every((s) => JSON.stringify(s) === first);
}

function firstSpec(specs: InputSignSpec[][]): InputSignSpec[] {
  const first = specs[0];
  if (!first) throw new Error('Empty batch spec');
  return first;
}

function requireSignedBase64(base64?: string, hex?: string): string {
  if (base64) return base64;
  if (hex) return hexToBase64(hex);
  throw new Error('Wallet returned no signed PSBT');
}

/**
 * Local base64→hex for the wallet RPCs that want hex. Avoids round-tripping through
 * bitcoinjs (which could drop unknown fields) — a straight byte transcode.
 */
function base64ToHexLocal(base64: string): string {
  const binary = globalThis.atob(base64);
  let hex = '';
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}
