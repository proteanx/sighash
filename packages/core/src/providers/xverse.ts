import * as bitcoin from 'bitcoinjs-lib';
import { listenKeys } from 'nanostores';
import {
  type AccountChangeEvent,
  AddressPurpose,
  BitcoinNetworkType,
  MessageSigningProtocols,
  type NetworkChangeEvent,
  RpcErrorCode,
  addListener,
  request,
  signMultipleTransactions,
} from 'sats-connect';
import {
  MAINNET,
  type NetworkType,
  REGTEST,
  SIGNET,
  TESTNET,
  TESTNET4,
} from '../constants/networks';
import { BIP322, ECDSA } from '../constants/signing-protocol';
import { XVERSE } from '../constants/wallets';
import { base64ToHex } from '../lib/encoding';
import {
  deriveInputsToSign,
  getBitcoinJsNetwork,
  inputsToSignRecord,
  toXverseInputsToSign,
} from '../lib/psbt';
import type { WalletCapabilities } from '../types/capabilities';
import type {
  InputToSign,
  SignPsbtsResponse,
  SignedPsbt,
  WalletProviderSignPsbtOptions,
  WalletProviderSignPsbtsOptions,
} from '../types/psbt';
import type { SignMessageOptions } from '../types/sign-message';
import { type ProviderFactory, WalletProvider, pickItemInputsToSign } from './base';

const DEFAULT_BULK_SIGN_MESSAGE = 'Sign multiple PSBTs';

/** Xverse's `signMultipleTransactions` caps the batch at 100 PSBTs. */
const XVERSE_BULK_LIMIT = 100;

function toBitcoinNetworkType(network: NetworkType): BitcoinNetworkType | undefined {
  switch (network) {
    case MAINNET:
      return BitcoinNetworkType.Mainnet;
    case TESTNET:
      return BitcoinNetworkType.Testnet;
    case TESTNET4:
      return BitcoinNetworkType.Testnet4;
    case SIGNET:
      return BitcoinNetworkType.Signet;
    case REGTEST:
      return BitcoinNetworkType.Regtest;
    default:
      return undefined;
  }
}

function networkFromBitcoinNetworkType(name: string): NetworkType | undefined {
  switch (name) {
    case BitcoinNetworkType.Mainnet:
      return MAINNET;
    case BitcoinNetworkType.Testnet:
      return TESTNET;
    case BitcoinNetworkType.Testnet4:
      return TESTNET4;
    case BitcoinNetworkType.Signet:
      return SIGNET;
    case BitcoinNetworkType.Regtest:
      return REGTEST;
    default:
      return undefined;
  }
}

interface XverseAccountAddress {
  address: string;
  publicKey: string;
  purpose: AddressPurpose;
}

function pickAddress(
  addresses: readonly XverseAccountAddress[],
  purpose: AddressPurpose,
): XverseAccountAddress | undefined {
  return addresses.find((a) => a.purpose === purpose);
}

/**
 * Detects Xverse's injected provider. Xverse populates `window.XverseProviders.BitcoinProvider`
 * (and historically also `window.BitcoinProvider`). We check the canonical namespace.
 */
function isXverseInjected(): boolean {
  const scope = globalThis as typeof globalThis & {
    XverseProviders?: { BitcoinProvider?: unknown };
  };
  return scope.XverseProviders?.BitcoinProvider !== undefined;
}

export class XverseProvider extends WalletProvider {
  readonly id = XVERSE;
  readonly capabilities: WalletCapabilities = {
    bulkSign: 'native',
    signMessageProtocols: [BIP322, ECDSA],
    switchNetwork: true,
  };

  private observer: MutationObserver | undefined;
  private listenersAttached = false;
  private listenerCleanups: Array<() => void> = [];
  private unsubscribeProviderKey: (() => void) | undefined;

  get installed(): boolean {
    return isXverseInjected();
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

    this.unsubscribeProviderKey = listenKeys(this.$store, ['provider'], (state) => {
      if (state.provider === XVERSE) {
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
    let result: { addresses: readonly XverseAccountAddress[]; networkName: string };
    try {
      result = await this.silentGetAccount();
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        result = await this.promptConnect();
      } else {
        throw error;
      }
    }

    const ordinals = pickAddress(result.addresses, AddressPurpose.Ordinals);
    const payment = pickAddress(result.addresses, AddressPurpose.Payment);
    if (!ordinals || !payment) {
      throw new Error('Xverse did not return both an ordinals and a payment address');
    }

    this.$store.setKey('address', ordinals.address);
    this.$store.setKey('paymentAddress', payment.address);
    this.$store.setKey('publicKey', ordinals.publicKey);
    this.$store.setKey('paymentPublicKey', payment.publicKey);
    this.$store.setKey(
      'accounts',
      result.addresses.map((a) => a.address),
    );

    const mappedNetwork = networkFromBitcoinNetworkType(result.networkName);
    if (mappedNetwork) {
      this.$network.set(mappedNetwork);
    }
  }

  private async silentGetAccount(): Promise<{
    addresses: readonly XverseAccountAddress[];
    networkName: string;
  }> {
    const response = await request('wallet_getAccount', null);
    if (response.status === 'success') {
      return {
        addresses: response.result.addresses as readonly XverseAccountAddress[],
        networkName: response.result.network.bitcoin.name,
      };
    }
    const message = response.error.message ?? '';
    if (isAccessDeniedMessage(message)) {
      throw new AccessDeniedError(message);
    }
    if (Number(response.error.code) === Number(RpcErrorCode.USER_REJECTION)) {
      throw new Error('User cancelled the Xverse connect request');
    }
    throw new Error(`Xverse connect failed: ${message}`);
  }

  private async promptConnect(): Promise<{
    addresses: readonly XverseAccountAddress[];
    networkName: string;
  }> {
    const response = await request('wallet_connect', {
      addresses: [AddressPurpose.Ordinals, AddressPurpose.Payment],
    });
    if (response.status === 'success') {
      return {
        addresses: response.result.addresses as readonly XverseAccountAddress[],
        networkName: response.result.network.bitcoin.name,
      };
    }
    if (Number(response.error.code) === Number(RpcErrorCode.USER_REJECTION)) {
      throw new Error('User cancelled the Xverse connect request');
    }
    throw new Error(`Xverse connect failed: ${response.error.message}`);
  }

  async signMessage(message: string, options: SignMessageOptions): Promise<string> {
    const toSignAddress = options.toSignAddress ?? this.$store.get().paymentAddress;
    if (!toSignAddress) {
      throw new Error('No address to sign with — wallet may not be connected');
    }
    const protocol =
      options.protocol === ECDSA ? MessageSigningProtocols.ECDSA : MessageSigningProtocols.BIP322;
    const response = await request('signMessage', {
      address: toSignAddress,
      message,
      protocol,
    });
    if (response.status === 'success') {
      return response.result.signature;
    }
    if (Number(response.error.code) === Number(RpcErrorCode.USER_REJECTION)) {
      throw new Error('User rejected the message-sign request');
    }
    throw new Error(`Xverse signMessage failed: ${response.error.message}`);
  }

  async signPsbt(options: WalletProviderSignPsbtOptions): Promise<SignedPsbt> {
    const signInputs = options.inputsToSign
      ? inputsToSignRecord(options.inputsToSign)
      : inputsToSignRecord(this.autoDeriveInputs(options.psbtBase64));

    const response = await request('signPsbt', {
      psbt: options.psbtBase64,
      broadcast: options.broadcast,
      signInputs,
    });

    if (response.status !== 'success') {
      if (Number(response.error.code) === Number(RpcErrorCode.USER_REJECTION)) {
        throw new Error('User rejected the PSBT signing request');
      }
      throw new Error(`Xverse signPsbt failed: ${response.error.message}`);
    }

    const signed = this.normalizeSignedPsbt(response.result.psbt);
    if (response.result.txid) {
      signed.txId = response.result.txid;
    }
    return signed;
  }

  override async signPsbts(options: WalletProviderSignPsbtsOptions): Promise<SignPsbtsResponse> {
    if (options.psbts.length === 0) {
      throw new Error('No PSBTs provided');
    }

    // `signMultipleTransactions` doesn't support broadcasting, and it caps the batch at
    // 100 PSBTs. For either case, fall back to the base class's sequential loop.
    if (options.broadcast || options.psbts.length > XVERSE_BULK_LIMIT) {
      return super.signPsbts(options);
    }

    const network = this.$network.get();
    const bitcoinNetwork = toBitcoinNetworkType(network);
    if (!bitcoinNetwork) {
      throw new Error(`Xverse does not support network: ${network}`);
    }

    const psbts = options.psbts.map((psbt, i) => {
      const itemInputs = pickItemInputsToSign(options.inputsToSign, i);
      const inputs = itemInputs ?? this.autoDeriveInputs(psbt.psbtBase64);
      if (inputs.length === 0) {
        // Xverse rejects an empty `inputsToSign`. If we can't derive any inputs, the
        // wallet has nothing to sign on this PSBT — surface the error early instead
        // of letting the wallet bounce the whole batch.
        throw new Error(
          `Cannot derive inputs to sign for PSBT at index ${i}: pass an explicit inputsToSign array`,
        );
      }
      return {
        psbtBase64: psbt.psbtBase64,
        inputsToSign: toXverseInputsToSign(inputs),
      };
    });

    return new Promise<SignPsbtsResponse>((resolve, reject) => {
      signMultipleTransactions({
        payload: {
          network: { type: bitcoinNetwork },
          message: DEFAULT_BULK_SIGN_MESSAGE,
          psbts,
        },
        onFinish: (response) => {
          try {
            const signedPsbts: SignedPsbt[] = [];
            for (let i = 0; i < response.length; i++) {
              const r = response[i];
              if (!r) {
                throw new Error(`Xverse returned an empty result at index ${i}`);
              }
              const entry = this.normalizeSignedPsbt(r.psbtBase64);
              if (r.txId) {
                entry.txId = r.txId;
              }
              signedPsbts.push(entry);
              options.onProgress?.(i + 1, response.length);
            }
            resolve({ signedPsbts, signingPath: 'native' });
          } catch (error) {
            reject(error);
          }
        },
        onCancel: () => {
          reject(new Error('User cancelled the bulk-sign request'));
        },
      });
    });
  }

  override async pushPsbt(_txHexOrBase64: string): Promise<string | undefined> {
    throw new Error(
      'Xverse does not expose a standalone broadcast RPC. ' +
        'Pass `broadcast: true` to `signPsbt` instead, or broadcast via your own data source.',
    );
  }

  async switchNetwork(network: NetworkType): Promise<void> {
    const type = toBitcoinNetworkType(network);
    if (!type) {
      throw new Error(`Xverse does not support network: ${network}`);
    }
    const response = await request('wallet_changeNetwork', { name: type });
    if (response.status !== 'success') {
      throw new Error(`Xverse switchNetwork failed: ${response.error.message}`);
    }
    this.$network.set(network);
  }

  async getNetwork(): Promise<NetworkType | undefined> {
    const response = await request('wallet_getNetwork', null);
    if (response.status !== 'success') return undefined;
    return networkFromBitcoinNetworkType(response.result.bitcoin.name);
  }

  /**
   * Round-trips Xverse's response PSBT through `bitcoinjs-lib` so we emit a canonical
   * byte form. Xverse's raw output occasionally contains key ordering or unknown-field
   * placements that downstream verifiers (e.g. ARKAiD's backend, which uses
   * bitcoinjs-lib) don't accept verbatim. The bytes are semantically identical — the
   * normalization just matches the encoder both ends speak.
   */
  private normalizeSignedPsbt(signedBase64: string): SignedPsbt {
    const network = getBitcoinJsNetwork(this.$network.get());
    try {
      const psbt = bitcoin.Psbt.fromBase64(signedBase64, { network });
      return {
        signedPsbtBase64: psbt.toBase64(),
        signedPsbtHex: psbt.toHex(),
      };
    } catch {
      // If bitcoinjs-lib can't parse it (truly malformed), fall back to byte-transcoding.
      return {
        signedPsbtBase64: signedBase64,
        signedPsbtHex: base64ToHex(signedBase64),
      };
    }
  }

  /**
   * Parses the PSBT and returns the inputs that match the connected wallet's
   * ordinals / payment addresses. Throws if the wallet isn't connected.
   */
  private autoDeriveInputs(psbtBase64: string): InputToSign[] {
    const { address, paymentAddress } = this.$store.get();
    if (!address || !paymentAddress) {
      throw new Error('Cannot auto-derive inputsToSign: Xverse is not connected');
    }
    return deriveInputsToSign(psbtBase64, {
      ordinalsAddress: address,
      paymentAddress,
      network: this.$network.get(),
    });
  }

  private markHasProvider(present: boolean): void {
    const current = this.$store.get().hasProvider;
    if (current[XVERSE] === present) return;
    this.$store.setKey('hasProvider', { ...current, [XVERSE]: present });
  }

  private attachWalletListeners(): void {
    if (this.listenersAttached) return;
    try {
      const removeAccount = addListener('accountChange', (_event: AccountChangeEvent) => {
        this.parent.connect(XVERSE).catch((error) => {
          console.error('Xverse: reconnect after accountChange failed', error);
        });
      });
      const removeNetwork = addListener('networkChange', (event: NetworkChangeEvent) => {
        const mapped = networkFromBitcoinNetworkType(event.bitcoin.name);
        if (mapped && this.$network.get() !== mapped) {
          this.$network.set(mapped);
        }
        this.parent.connect(XVERSE).catch((error) => {
          console.error('Xverse: reconnect after networkChange failed', error);
        });
      });
      this.listenerCleanups = [removeAccount, removeNetwork];
      this.listenersAttached = true;
    } catch (error) {
      // sats-connect may throw if no provider has been selected yet. Listeners can be
      // re-attached after the next successful connect() cycles the provider key.
      console.warn('Xverse: could not attach wallet listeners (will retry on next connect)', error);
    }
  }

  private detachWalletListeners(): void {
    for (const cleanup of this.listenerCleanups) {
      try {
        cleanup();
      } catch {
        // ignore — best-effort
      }
    }
    this.listenerCleanups = [];
    this.listenersAttached = false;
  }
}

class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

function isAccessDeniedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to get') ||
    lower.includes('access denied') ||
    lower.includes('no account')
  );
}

/** Factory for {@link XverseProvider}. Pass to {@link SighashConfig.providers}. */
export function xverseProvider(): ProviderFactory {
  return (stores, parent) => new XverseProvider(stores, parent);
}
