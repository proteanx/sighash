/**
 * Describes which PSBT inputs the wallet should sign. The optional `publicKey` and
 * `sighashTypes` fields are honored by OKX (and by UniSat in some configurations) — see
 * the ARKAiD audit §6.3 for the OKX buyer-offer placeholder-input pattern.
 */
export interface InputToSign {
  index: number;
  address: string;
  publicKey?: string;
  sighashTypes?: number[];
}

/**
 * Public options for {@link SighashClient.signPsbt}. The `tx` field may be either hex or
 * base64 — the client resolves the alternate format before dispatching to the provider.
 */
export interface SignPsbtOptions {
  tx: string;
  finalize?: boolean;
  broadcast?: boolean;
  inputsToSign?: InputToSign[];
}

/**
 * Per-PSBT inputs map: a flat `InputToSign[]` applies to every PSBT in the batch, while
 * a nested `InputToSign[][]` applies position-by-position.
 */
export type BulkInputsToSign = InputToSign[] | InputToSign[][];

/**
 * Public options for {@link SighashClient.signPsbts}. Progress callbacks fire after each
 * individual PSBT is signed — useful for sequential-fallback wallets so the UI can show a
 * progress bar.
 */
export interface SignPsbtsOptions {
  psbts: string[];
  finalize?: boolean;
  broadcast?: boolean;
  inputsToSign?: BulkInputsToSign;
  onProgress?: (signedIndex: number, total: number) => void;
}

/** A single signed PSBT in whatever format(s) the underlying wallet provided. */
export interface SignedPsbt {
  signedPsbtHex?: string;
  signedPsbtBase64?: string;
  txId?: string;
}

/**
 * Always populated — providers throw on user cancellation rather than returning
 * `undefined`. At least one of `signedPsbtBase64` / `signedPsbtHex` will be set; both
 * may be set when the underlying RPC returns one and the client transcodes the other.
 */
export type SignPsbtResponse = SignedPsbt;

export interface SignPsbtsResponse {
  signedPsbts: SignedPsbt[];
  /**
   * Which path actually ran. `'native'` = one wallet prompt covering all PSBTs via the
   * wallet's bulk RPC. `'sequential'` = one prompt per PSBT through `signPsbt` — either
   * because the wallet doesn't expose a bulk RPC, or because we fell back after the
   * bulk call failed. Consumers can use this to decide whether to show "N prompts
   * coming" hints or to track which wallets actually deliver the one-prompt UX.
   */
  signingPath: 'native' | 'sequential';
}

/**
 * PSBT with both encodings precomputed; the client resolves user-supplied input into this
 * shape before dispatching to a provider so providers can pick whichever encoding their
 * wallet RPC prefers without re-parsing.
 */
export interface ResolvedPsbt {
  tx: string;
  psbtHex: string;
  psbtBase64: string;
}

/** Options passed to {@link WalletProvider.signPsbt}. All fields are resolved by the client. */
export interface WalletProviderSignPsbtOptions extends ResolvedPsbt {
  finalize: boolean;
  broadcast: boolean;
  inputsToSign?: InputToSign[];
}

/** Options passed to {@link WalletProvider.signPsbts}. */
export interface WalletProviderSignPsbtsOptions {
  psbts: ResolvedPsbt[];
  finalize: boolean;
  broadcast: boolean;
  inputsToSign?: BulkInputsToSign;
  onProgress?: (signedIndex: number, total: number) => void;
}
