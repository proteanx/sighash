import { type MapStore, type WritableAtom, listenKeys } from 'nanostores';
import type { SighashClient } from '../client';
import {
  MAINNET,
  type NetworkType,
  REGTEST,
  SIGNET,
  TESTNET,
  TESTNET4,
} from '../constants/networks';
import { BIP322, ECDSA } from '../constants/signing-protocol';
import { UNISAT } from '../constants/wallets';
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
import type { WalletStore } from '../types/store';
import { type ProviderFactory, WalletProvider } from './base';

const UNISAT_BIP322_SIMPLE = 'bip322-simple';
const UNISAT_ECDSA = 'ecdsa';

/**
 * UniSat-side chain enums. UniSat exposes `getChain()` and `switchChain()` rather than a
 * single `getNetwork()` — its enum values do not match our `NetworkType` strings.
 */
const UNISAT_CHAIN = {
  BITCOIN_MAINNET: 'BITCOIN_MAINNET',
  BITCOIN_TESTNET: 'BITCOIN_TESTNET',
  BITCOIN_TESTNET4: 'BITCOIN_TESTNET4',
  BITCOIN_SIGNET: 'BITCOIN_SIGNET',
} as const;

function networkFromUnisatChain(chainEnum: string): NetworkType | undefined {
  switch (chainEnum) {
    case UNISAT_CHAIN.BITCOIN_MAINNET:
      return MAINNET;
    case UNISAT_CHAIN.BITCOIN_TESTNET:
      return TESTNET;
    case UNISAT_CHAIN.BITCOIN_TESTNET4:
      return TESTNET4;
    case UNISAT_CHAIN.BITCOIN_SIGNET:
      return SIGNET;
    default:
      return undefined;
  }
}

function unisatChainFromNetwork(network: NetworkType): string | undefined {
  switch (network) {
    case MAINNET:
      return UNISAT_CHAIN.BITCOIN_MAINNET;
    case TESTNET:
      return UNISAT_CHAIN.BITCOIN_TESTNET;
    case TESTNET4:
      return UNISAT_CHAIN.BITCOIN_TESTNET4;
    case SIGNET:
      return UNISAT_CHAIN.BITCOIN_SIGNET;
    case REGTEST:
      // UniSat doesn't support regtest.
      return undefined;
    default:
      return undefined;
  }
}

export interface UnisatLibrary {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getPublicKey(): Promise<string>;
  signMessage(message: string, type?: string): Promise<string>;
  signPsbt(psbtHex: string, options?: UnisatSignOptions): Promise<string>;
  signPsbts(psbtHexs: string[], options?: UnisatSignOptions): Promise<string[]>;
  pushPsbt(psbtHex: string): Promise<string>;
  getChain(): Promise<UnisatChainInfo>;
  switchChain(chain: string): Promise<UnisatChainInfo>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

export interface UnisatChainInfo {
  enum: string;
  name: string;
  network: string;
}

export interface UnisatSignOptions {
  autoFinalized?: boolean;
  toSignInputs?: UnisatToSignInput[];
}

export interface UnisatToSignInput {
  index: number;
  address?: string;
  publicKey?: string;
  sighashTypes?: number[];
  disableTweakSigner?: boolean;
}

export interface UnisatProviderConfig {
  /**
   * Forces sequential bulk signing (one wallet prompt per PSBT) even when UniSat's
   * native bulk RPC is available.
   *
   * Background: historically `unisat.signPsbts(psbts, { autoFinalized: false })` has
   * been reported to finalize PSBTs anyway — which breaks marketplace partial-sign
   * flows (e.g. seller-side listing PSBTs that must remain unfinalized so the buyer
   * can later add their signature). Setting this flag falls back to the base class's
   * sequential signPsbts implementation, which calls `signPsbt` (single) N times — the
   * single-PSBT path has always honored `autoFinalized: false` correctly.
   *
   * Default: `false`. The native bulk path is preferred for the single-prompt UX,
   * and our implementation passes `autoFinalized` *explicitly* (rather than letting
   * UniSat fall back to its default-true behavior). Flip to `true` if real-world
   * testing shows finalization happening despite our explicit option.
   */
  forceSequentialBulkSign?: boolean;
}

/**
 * Detects extension presence by reading `window.unisat`. We read at access time (not
 * at construction) so the value reflects the most recent extension-injection state.
 */
function readGlobalLibrary(): UnisatLibrary | undefined {
  const scope = globalThis as typeof globalThis & { unisat?: UnisatLibrary };
  return scope.unisat;
}

export class UnisatProvider extends WalletProvider {
  readonly id = UNISAT;
  readonly capabilities: WalletCapabilities;

  private observer: MutationObserver | undefined;
  private listenersAttached = false;
  private unsubscribeProviderKey: (() => void) | undefined;
  private readonly config: UnisatProviderConfig;

  constructor(
    stores: { $store: MapStore<WalletStore>; $network: WritableAtom<NetworkType> },
    parent: SighashClient,
    config: UnisatProviderConfig = {},
  ) {
    super(stores, parent);
    this.config = config;
    this.capabilities = {
      bulkSign: config.forceSequentialBulkSign ? 'sequential' : 'native',
      signMessageProtocols: [BIP322, ECDSA],
      switchNetwork: true,
    };
  }

  get library(): UnisatLibrary | undefined {
    return readGlobalLibrary();
  }

  get installed(): boolean {
    return this.library !== undefined;
  }

  initialize(): void {
    // SSR/Node guard: nothing to wire up if we have no DOM or no global.
    const hasDom = typeof document !== 'undefined' && typeof MutationObserver !== 'undefined';

    // Synchronous probe — the extension may already be injected by the time we mount.
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

    // Attach wallet listeners only while UniSat is the active provider — avoids
    // stale handlers firing for events the user no longer cares about.
    this.unsubscribeProviderKey = listenKeys(this.$store, ['provider'], (state) => {
      if (state.provider === UNISAT) {
        this.attachWalletListeners();
      } else {
        this.detachWalletListeners();
      }
    });
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.unsubscribeProviderKey?.();
    this.unsubscribeProviderKey = undefined;
    this.detachWalletListeners();
  }

  override disconnect(): void {
    this.detachWalletListeners();
  }

  async connect(): Promise<void> {
    const lib = this.requireLibrary();
    const accounts = await lib.requestAccounts();
    if (!accounts || accounts.length === 0) {
      throw new Error('UniSat returned no accounts');
    }
    const publicKey = await lib.getPublicKey();
    if (!publicKey) {
      throw new Error('UniSat returned no public key');
    }
    const primary = accounts[0];
    if (!primary) {
      throw new Error('UniSat returned no primary account');
    }
    // UniSat uses one address for both ordinals and payment.
    this.$store.setKey('address', primary);
    this.$store.setKey('paymentAddress', primary);
    this.$store.setKey('publicKey', publicKey);
    this.$store.setKey('paymentPublicKey', publicKey);
    this.$store.setKey('accounts', accounts);
  }

  async signMessage(message: string, options: SignMessageOptions): Promise<string> {
    const lib = this.requireLibrary();
    // Default to UniSat's native default (ECDSA) when no protocol is specified, so that
    // signatures match what lasereyes-based callers already produce. Explicit BIP322
    // requests are mapped to UniSat's bip322-simple variant.
    const type = options.protocol === BIP322 ? UNISAT_BIP322_SIMPLE : UNISAT_ECDSA;
    return lib.signMessage(message, type);
  }

  async signPsbt(options: WalletProviderSignPsbtOptions): Promise<SignedPsbt> {
    const lib = this.requireLibrary();
    const signOpts = buildUnisatSignOptions(options.finalize, options.inputsToSign);
    const signedHex = await lib.signPsbt(options.psbtHex, signOpts);
    const signed: SignedPsbt = {
      signedPsbtHex: signedHex,
      signedPsbtBase64: hexToBase64(signedHex),
    };
    if (options.finalize && options.broadcast) {
      signed.txId = await lib.pushPsbt(signedHex);
    }
    return signed;
  }

  override async signPsbts(options: WalletProviderSignPsbtsOptions): Promise<SignPsbtsResponse> {
    if (options.psbts.length === 0) {
      throw new Error('No PSBTs provided');
    }

    // Sequential fallback path: either explicitly requested via config, or required
    // because the caller passed per-PSBT `inputsToSign` (UniSat's bulk RPC only accepts
    // a single `toSignInputs` that applies to every PSBT in the batch).
    const inputs = options.inputsToSign;
    const wantsPerPsbtInputs =
      inputs !== undefined && inputs.length > 0 && Array.isArray(inputs[0]);

    if (this.config.forceSequentialBulkSign || wantsPerPsbtInputs) {
      return super.signPsbts(options);
    }

    const lib = this.requireLibrary();
    const psbtHexs = options.psbts.map((p) => p.psbtHex);
    // Cast is safe: we've already guarded against the nested form above.
    const flatInputs = options.inputsToSign as InputToSign[] | undefined;
    const signOpts = buildUnisatSignOptions(options.finalize, flatInputs);

    const signedHexs = await lib.signPsbts(psbtHexs, signOpts);

    if (signedHexs.length !== psbtHexs.length) {
      throw new Error(
        `UniSat returned ${signedHexs.length} signed PSBTs for ${psbtHexs.length} inputs`,
      );
    }

    const signedPsbts: SignedPsbt[] = [];
    for (let i = 0; i < signedHexs.length; i++) {
      const signedHex = signedHexs[i];
      if (!signedHex) {
        throw new Error(`UniSat returned an empty result at index ${i}`);
      }
      const entry: SignedPsbt = {
        signedPsbtHex: signedHex,
        signedPsbtBase64: hexToBase64(signedHex),
      };
      if (options.finalize && options.broadcast) {
        entry.txId = await lib.pushPsbt(signedHex);
      }
      signedPsbts.push(entry);
      options.onProgress?.(i + 1, signedHexs.length);
    }

    return { signedPsbts };
  }

  override async pushPsbt(txHexOrBase64: string): Promise<string | undefined> {
    const lib = this.requireLibrary();
    // UniSat's pushPsbt accepts hex strings.
    return lib.pushPsbt(txHexOrBase64);
  }

  async switchNetwork(network: NetworkType): Promise<void> {
    const chain = unisatChainFromNetwork(network);
    if (!chain) {
      throw new Error(`UniSat does not support network: ${network}`);
    }
    const lib = this.requireLibrary();
    await lib.switchChain(chain);
    this.$network.set(network);
  }

  async getNetwork(): Promise<NetworkType | undefined> {
    const info = await this.library?.getChain();
    if (!info) return undefined;
    return networkFromUnisatChain(info.enum);
  }

  private markHasProvider(present: boolean): void {
    const current = this.$store.get().hasProvider;
    if (current[UNISAT] === present) return;
    this.$store.setKey('hasProvider', { ...current, [UNISAT]: present });
  }

  private requireLibrary(): UnisatLibrary {
    const lib = this.library;
    if (!lib) {
      throw new Error('UniSat extension is not installed or not yet injected');
    }
    return lib;
  }

  private attachWalletListeners(): void {
    if (this.listenersAttached) return;
    const lib = this.library;
    if (!lib) return;
    lib.on('accountsChanged', this.handleAccountsChanged);
    lib.on('networkChanged', this.handleNetworkChanged);
    this.listenersAttached = true;
  }

  private detachWalletListeners(): void {
    if (!this.listenersAttached) return;
    const lib = this.library;
    if (lib) {
      lib.removeListener('accountsChanged', this.handleAccountsChanged);
      lib.removeListener('networkChanged', this.handleNetworkChanged);
    }
    this.listenersAttached = false;
  }

  private readonly handleAccountsChanged = (...args: unknown[]): void => {
    const raw = args[0];
    if (!Array.isArray(raw)) return;
    const accounts = raw.filter((a): a is string => typeof a === 'string');
    if (accounts.length === 0) {
      this.parent.disconnect();
      return;
    }
    if (this.$store.get().accounts[0] === accounts[0]) {
      return;
    }
    // Defer the reconnect so we don't recurse into a connect() while the previous
    // promise from the same call site is still settling.
    queueMicrotask(() => {
      this.parent.connect(UNISAT).catch((error) => {
        console.error('UniSat: failed to reconnect after accountsChanged', error);
      });
    });
  };

  private readonly handleNetworkChanged = (...args: unknown[]): void => {
    const chainEnum = typeof args[0] === 'string' ? args[0] : '';
    const network = networkFromUnisatChain(chainEnum);
    if (network && this.$network.get() !== network) {
      this.$network.set(network);
    }
    queueMicrotask(() => {
      this.parent.connect(UNISAT).catch((error) => {
        console.error('UniSat: failed to reconnect after networkChanged', error);
      });
    });
  };
}

function buildUnisatSignOptions(
  finalize: boolean,
  inputsToSign: InputToSign[] | undefined,
): UnisatSignOptions {
  // Always pass `autoFinalized` explicitly. UniSat's API defaults to `true` for
  // both `signPsbt` and `signPsbts` when the option is omitted — that default
  // breaks partial-sign flows (e.g. marketplace listings where the seller signs
  // their input but leaves the buyer's input unsigned). By always passing the
  // resolved boolean we never fall back to the wallet's default.
  const result: UnisatSignOptions = { autoFinalized: finalize };
  if (inputsToSign && inputsToSign.length > 0) {
    result.toSignInputs = inputsToSign.map(toUnisatInput);
  }
  return result;
}

function toUnisatInput(input: InputToSign): UnisatToSignInput {
  const out: UnisatToSignInput = {
    index: input.index,
    address: input.address,
  };
  if (input.publicKey !== undefined) out.publicKey = input.publicKey;
  if (input.sighashTypes !== undefined) out.sighashTypes = input.sighashTypes;
  return out;
}

/** Factory for {@link UnisatProvider}. Pass to {@link SighashConfig.providers}. */
export function unisatProvider(config?: UnisatProviderConfig): ProviderFactory {
  return (stores, parent) => new UnisatProvider(stores, parent, config);
}
