import { listenKeys } from 'nanostores';
import {
  MAINNET,
  type NetworkType,
  REGTEST,
  SIGNET,
  TESTNET,
  TESTNET4,
} from '../constants/networks';
import { BIP322, ECDSA } from '../constants/signing-protocol';
import { OKX } from '../constants/wallets';
import { hexToBase64 } from '../lib/encoding';
import type { WalletCapabilities } from '../types/capabilities';
import type {
  InputToSign,
  SignPsbtsResponse,
  SignedPsbt,
  WalletProviderSignPsbtOptions,
  WalletProviderSignPsbtsOptions,
} from '../types/psbt';
import type { SignMessageOptions } from '../types/sign-message';
import { type ProviderFactory, WalletProvider } from './base';

const OKX_BIP322_SIMPLE = 'bip322-simple';
const OKX_ECDSA = 'ecdsa';

const OKX_NETWORK = {
  MAINNET: 'livenet',
  TESTNET: 'testnet',
} as const;

function networkFromOkxNetwork(value: string): NetworkType | undefined {
  switch (value) {
    case OKX_NETWORK.MAINNET:
      return MAINNET;
    case OKX_NETWORK.TESTNET:
      return TESTNET;
    default:
      return undefined;
  }
}

/**
 * OKX wallet's per-input signing descriptor — superset of UniSat's. Our public
 * `InputToSign` already includes `publicKey` and `sighashTypes`; the OKX-only
 * `tapLeafHashToSign` / `disableTweakSigner` / `useTweakSigner` fields are not part of our
 * canonical type because no MVP caller (ARKAiD's `okx-signing.ts` included) needs them.
 */
export interface OkxToSignInput {
  index: number;
  address?: string;
  publicKey?: string;
  sighashTypes?: number[];
}

export interface OkxSignOptions {
  autoFinalized?: boolean;
  toSignInputs?: OkxToSignInput[];
}

export interface OkxConnectResult {
  address: string;
  publicKey: string;
  compressedPublicKey?: string;
}

/**
 * Minimal shape of OKX's injected Bitcoin provider. Methods we may invoke conditionally
 * (`signPsbts`, `signMultiplePsbts`, `pushPsbt`, `getNetwork`) are declared optional —
 * older OKX builds may not expose them.
 */
export interface OkxLibrary {
  connect(): Promise<OkxConnectResult>;
  requestAccounts?(): Promise<string[]>;
  getAccounts?(): Promise<string[]>;
  getPublicKey?(): Promise<string>;
  getNetwork?(): Promise<string>;
  signMessage(message: string, type?: string): Promise<string>;
  signPsbt(psbtHex: string, options?: OkxSignOptions): Promise<string>;
  signPsbts?(psbtHexs: string[], options?: OkxSignOptions): Promise<string[]>;
  signMultiplePsbts?(psbtHexs: string[], options?: OkxSignOptions): Promise<string[]>;
  pushPsbt?(psbtHex: string): Promise<string>;
}

interface OkxWalletGlobal {
  bitcoin?: OkxLibrary;
  bitcoinTestnet?: OkxLibrary;
}

function getOkxWallet(): OkxWalletGlobal | undefined {
  const scope = globalThis as typeof globalThis & { okxwallet?: OkxWalletGlobal };
  return scope.okxwallet;
}

/**
 * OKX exposes mainnet and testnet under separate namespaces. We resolve the right one
 * at access time so a network switch is picked up automatically.
 */
function readOkxLibrary(network: NetworkType): OkxLibrary | undefined {
  const wallet = getOkxWallet();
  if (!wallet) return undefined;
  if (network === MAINNET) {
    return wallet.bitcoin;
  }
  if (network === TESTNET || network === TESTNET4 || network === SIGNET || network === REGTEST) {
    return wallet.bitcoinTestnet;
  }
  return wallet.bitcoin;
}

export class OkxProvider extends WalletProvider {
  readonly id = OKX;
  readonly capabilities: WalletCapabilities = {
    // Optimistic: modern OKX builds expose a bulk-sign primitive. The provider probes
    // at runtime and falls back to the sequential loop if the method isn't present, so
    // consumers always see successful bulk-sign even on older OKX builds.
    bulkSign: 'native',
    signMessageProtocols: [BIP322, ECDSA],
    // OKX does not expose a programmatic network switch — users change networks in
    // the extension UI.
    switchNetwork: false,
  };

  private observer: MutationObserver | undefined;
  private unsubscribeProviderKey: (() => void) | undefined;

  get library(): OkxLibrary | undefined {
    return readOkxLibrary(this.$network.get());
  }

  get installed(): boolean {
    const wallet = getOkxWallet();
    return wallet?.bitcoin !== undefined || wallet?.bitcoinTestnet !== undefined;
  }

  initialize(): void {
    const hasDom = typeof document !== 'undefined' && typeof MutationObserver !== 'undefined';

    if (this.installed) {
      this.markHasProvider(true);
    } else if (hasDom) {
      this.observer = new MutationObserver(() => {
        if (this.installed) {
          this.markHasProvider(true);
          this.observer?.disconnect();
        }
      });
      this.observer.observe(document, { childList: true, subtree: true });
    }

    this.unsubscribeProviderKey = listenKeys(this.$store, ['provider'], () => {
      // OKX's extension doesn't expose event-emitter accountChange / networkChange APIs
      // the way UniSat and Xverse do, so we have no listeners to attach/detach here.
      // The provider key listener is kept for parity with the other providers and to
      // anchor future event-wire-ups.
    });
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.unsubscribeProviderKey?.();
    this.unsubscribeProviderKey = undefined;
  }

  async connect(): Promise<void> {
    const lib = this.requireLibrary();
    const result = await lib.connect();
    if (!result || !result.address || !result.publicKey) {
      throw new Error('OKX returned an incomplete connect result');
    }
    // OKX exposes a single address for both ordinals and payment purposes.
    this.$store.setKey('address', result.address);
    this.$store.setKey('paymentAddress', result.address);
    this.$store.setKey('publicKey', result.publicKey);
    this.$store.setKey('paymentPublicKey', result.publicKey);
    this.$store.setKey('accounts', [result.address]);
  }

  async signMessage(message: string, options: SignMessageOptions): Promise<string> {
    const lib = this.requireLibrary();
    // BIP322 → OKX's bip322-simple; ECDSA (default) → OKX's ecdsa. Intentionally
    // *not* matching the lasereyes OKX impl, which inverted the mapping (lasereyes
    // sent bip322-simple when callers asked for ECDSA — a long-standing bug).
    const type = options.protocol === BIP322 ? OKX_BIP322_SIMPLE : OKX_ECDSA;
    return lib.signMessage(message, type);
  }

  async signPsbt(options: WalletProviderSignPsbtOptions): Promise<SignedPsbt> {
    const lib = this.requireLibrary();
    const signOpts = buildOkxSignOptions(options.finalize, options.inputsToSign);
    const signedHex = await lib.signPsbt(options.psbtHex, signOpts);
    const signed: SignedPsbt = {
      signedPsbtHex: signedHex,
      signedPsbtBase64: hexToBase64(signedHex),
    };
    if (options.finalize && options.broadcast) {
      const broadcast = lib.pushPsbt;
      if (typeof broadcast !== 'function') {
        throw new Error(
          'OKX did not expose pushPsbt; sign without broadcast and broadcast via your own data source.',
        );
      }
      signed.txId = await broadcast.call(lib, signedHex);
    }
    return signed;
  }

  override async signPsbts(options: WalletProviderSignPsbtsOptions): Promise<SignPsbtsResponse> {
    if (options.psbts.length === 0) {
      throw new Error('No PSBTs provided');
    }

    const inputs = options.inputsToSign;
    const wantsPerPsbtInputs =
      inputs !== undefined && inputs.length > 0 && Array.isArray(inputs[0]);

    // OKX's bulk RPC, like UniSat's, accepts a single `toSignInputs` that applies to
    // every PSBT in the batch. Per-PSBT inputs require the sequential fallback.
    if (wantsPerPsbtInputs) {
      return super.signPsbts(options);
    }

    const lib = this.requireLibrary();
    const bulkFn = lib.signPsbts ?? lib.signMultiplePsbts;
    if (typeof bulkFn !== 'function') {
      // Older OKX builds without a bulk RPC: transparent sequential fallback.
      return super.signPsbts(options);
    }

    const flatInputs = inputs as InputToSign[] | undefined;
    const signOpts = buildOkxSignOptions(options.finalize, flatInputs);
    const psbtHexs = options.psbts.map((p) => p.psbtHex);

    let signedHexs: string[];
    try {
      signedHexs = await bulkFn.call(lib, psbtHexs, signOpts);
    } catch (err) {
      if (isUserRejection(err)) {
        throw new Error('User rejected the OKX bulk-sign request');
      }
      // OKX's bulk RPC threw for some other reason — could be a wallet build that
      // exposes the method name but doesn't actually implement it, an unexpected
      // payload shape, etc. Surface a useful error and transparently fall back to the
      // single-sign loop so the user can still complete the batch.
      console.warn(
        `[sighash] OKX bulk-sign RPC failed; falling back to sequential signPsbt loop. Original wallet error: ${formatWalletError(err)}`,
      );
      return super.signPsbts(options);
    }

    if (!Array.isArray(signedHexs) || signedHexs.length !== psbtHexs.length) {
      throw new Error(
        `OKX returned an unexpected bulk-sign result: ${formatWalletError(signedHexs)}`,
      );
    }

    const signedPsbts: SignedPsbt[] = [];
    for (let i = 0; i < signedHexs.length; i++) {
      const signedHex = signedHexs[i];
      if (!signedHex) {
        throw new Error(`OKX returned an empty result at index ${i}`);
      }
      const entry: SignedPsbt = {
        signedPsbtHex: signedHex,
        signedPsbtBase64: hexToBase64(signedHex),
      };
      if (options.finalize && options.broadcast && typeof lib.pushPsbt === 'function') {
        entry.txId = await lib.pushPsbt(signedHex);
      }
      signedPsbts.push(entry);
      options.onProgress?.(i + 1, signedHexs.length);
    }

    return { signedPsbts, signingPath: 'native' };
  }

  override async pushPsbt(txHexOrBase64: string): Promise<string | undefined> {
    const lib = this.requireLibrary();
    if (typeof lib.pushPsbt !== 'function') {
      throw new Error('OKX does not expose pushPsbt on this build');
    }
    return lib.pushPsbt(txHexOrBase64);
  }

  async getNetwork(): Promise<NetworkType | undefined> {
    const lib = this.library;
    if (!lib || typeof lib.getNetwork !== 'function') {
      return undefined;
    }
    const raw = await lib.getNetwork();
    return networkFromOkxNetwork(raw);
  }

  private markHasProvider(present: boolean): void {
    const current = this.$store.get().hasProvider;
    if (current[OKX] === present) return;
    this.$store.setKey('hasProvider', { ...current, [OKX]: present });
  }

  private requireLibrary(): OkxLibrary {
    const lib = this.library;
    if (!lib) {
      const network = this.$network.get();
      throw new Error(
        `OKX wallet is not available for network "${network}". Install the OKX extension and switch the wallet to a network sighash supports.`,
      );
    }
    return lib;
  }
}

function buildOkxSignOptions(
  finalize: boolean,
  inputsToSign: InputToSign[] | undefined,
): OkxSignOptions {
  // OKX's `autoFinalized` default is `true` (same as UniSat). We always pass the
  // resolved boolean explicitly so partial-sign flows (e.g. ARKAiD's offer / listing
  // PSBTs) never accidentally finalize.
  const result: OkxSignOptions = { autoFinalized: finalize };
  if (inputsToSign && inputsToSign.length > 0) {
    result.toSignInputs = inputsToSign.map(toOkxInput);
  }
  return result;
}

function toOkxInput(input: InputToSign): OkxToSignInput {
  const out: OkxToSignInput = {
    index: input.index,
    address: input.address,
  };
  if (input.publicKey !== undefined) out.publicKey = input.publicKey;
  if (input.sighashTypes !== undefined) out.sighashTypes = input.sighashTypes;
  return out;
}

/**
 * OKX (like every EIP-1193-ish wallet) sometimes rejects with a plain object instead of
 * a real `Error`. Pull a useful string out of whatever the wallet threw.
 */
function formatWalletError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message;
    if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error;
    if (typeof obj.code === 'number' || typeof obj.code === 'string') {
      return `code ${obj.code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

function isUserRejection(err: unknown): boolean {
  if (err instanceof Error) {
    return /reject|cancel|user.+denied|user.+declined/i.test(err.message);
  }
  if (err && typeof err === 'object') {
    const obj = err as { code?: number | string; message?: string };
    // EIP-1193 rejection code is 4001; some wallets use -32000.
    if (obj.code === 4001 || obj.code === -32000 || obj.code === '4001') return true;
    if (typeof obj.message === 'string') {
      return /reject|cancel|user.+denied|user.+declined/i.test(obj.message);
    }
  }
  return false;
}

/** Factory for {@link OkxProvider}. Pass to {@link SighashConfig.providers}. */
export function okxProvider(): ProviderFactory {
  return (stores, parent) => new OkxProvider(stores, parent);
}
