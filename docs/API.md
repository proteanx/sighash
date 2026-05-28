# sighash API reference

Complete API contracts for [`@sighash-dev/core`](../packages/core) and [`@sighash-dev/react`](../packages/react), verified against the v0.1.0 source.

- Every public export is documented: signature, parameter defaults, return type, what it throws, and any per-wallet behavioral differences.
- `@sighash-dev/react` re-exports **all** of `@sighash-dev/core` (via `export * from '@sighash-dev/core'`), so everything in the Core section is also importable from `@sighash-dev/react`.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Mental model](#mental-model)
- [Core: `SighashClient`](#core-sighashclient)
- [Core: stores & state](#core-stores--state)
- [Core: providers](#core-providers)
- [Core: PSBT options & response types](#core-psbt-options--response-types)
- [Core: constants](#core-constants)
- [Core: PSBT helpers](#core-psbt-helpers)
- [Core: encoding helpers](#core-encoding-helpers)
- [Core: `broadcastTx`](#core-broadcasttx)
- [React: `SighashProvider`](#react-sighashprovider)
- [React: `useSighash`](#react-usesighash)
- [React: context & compatibility aliases](#react-context--compatibility-aliases)
- [Behavioral contracts](#behavioral-contracts)
- [Per-provider reference](#per-provider-reference)
- [Error reference](#error-reference)

---

## Installation

```bash
# Framework-agnostic core
pnpm add @sighash-dev/core nanostores

# React bindings (pulls in core)
pnpm add @sighash-dev/react @sighash-dev/core nanostores react
```

`nanostores` is a **peer dependency** of both packages — install it in your app. `bitcoinjs-lib`, `sats-connect`, and `@bitcoinerlab/secp256k1` are bundled dependencies of `@sighash-dev/core`; you don't need to install them yourself.

---

## Quick start

### Core (no framework)

```ts
import {
  SighashClient,
  createStores,
  unisatProvider,
  xverseProvider,
  okxProvider,
  UNISAT,
} from '@sighash-dev/core';

const stores = createStores({ network: 'mainnet' });
const client = new SighashClient(stores, {
  providers: [unisatProvider(), xverseProvider(), okxProvider()],
});
client.initialize();

await client.connect(UNISAT);
const { signedPsbtBase64 } = await client.signPsbt(psbtBase64);
```

> **Note:** the core `SighashClient` does **not** auto-register providers — if you omit
> `config.providers`, no wallets are available. (The React `<SighashProvider>` _does_
> auto-register; see below.)

### React

```tsx
import { SighashProvider, useSighash } from '@sighash-dev/react';
import { UNISAT } from '@sighash-dev/core';

// Define config at module scope (or memoize it) — it must be stable across renders.
const config = { network: 'mainnet' } as const;

function App() {
  return (
    <SighashProvider config={config}>
      <Wallet />
    </SighashProvider>
  );
}

function Wallet() {
  const { connect, connected, address, signPsbts, hasUnisat } = useSighash();
  if (!connected) {
    return <button disabled={!hasUnisat} onClick={() => connect(UNISAT)}>Connect</button>;
  }
  return <p>{address}</p>;
}
```

---

## Mental model

- **The client owns the public API.** `SighashClient` exposes `connect`, `signMessage`, `signPsbt`, `signPsbts`, `pushPsbt`, and `capabilities`. Wallet-specific behavior lives in `WalletProvider` subclasses.
- **State lives in nanostores.** `createStores()` returns a `$store` (a `MapStore<WalletStore>`) and a `$network` atom. The client and providers write to these; your UI subscribes (the React hook does this for you via `useSyncExternalStore`).
- **Providers are registered via factories.** `unisatProvider()`, `xverseProvider()`, `okxProvider()` return a `ProviderFactory`; pass them to `SighashConfig.providers`.
- **PSBT inputs are auto-encoded.** Pass a PSBT as hex _or_ base64; the client transcodes to both before dispatching, so each wallet picks the encoding its RPC prefers.

---

## Core: `SighashClient`

```ts
class SighashClient {
  readonly $store: MapStore<WalletStore>;
  readonly $network: WritableAtom<NetworkType>;
  readonly providers: Partial<Record<ProviderType, WalletProvider>>;

  constructor(stores: Stores, config?: SighashConfig);
}
```

### `SighashConfig`

```ts
interface SighashConfig {
  /** Initial network. Defaults to 'mainnet'. */
  network?: NetworkType;
  /** Factories for the wallet providers this client should support. */
  providers?: readonly ProviderFactory[];
}
```

If `providers` is omitted, the client registers **none** — `connect()` will throw `Provider not registered`. Always pass the providers you want.

### `constructor(stores, config?)`

Builds each provider from its factory and indexes them by `provider.id`. Sets the initial network from `config.network` (default `'mainnet'`). Does **not** start extension detection — call `initialize()` after construction.

### `initialize(): void`

Starts each provider's `MutationObserver` / event listeners, sets `isInitializing: true`, then flips it to `false` on the next microtask. Call exactly once after construction. No-op if the client has been disposed.

### `dispose(): void`

Tears down every provider's listeners. Idempotent (safe to call multiple times). After disposal, `connect` / sign methods throw.

### `connect(providerId: ProviderType): Promise<void>`

Authorizes the connection for the given provider. On success, the provider populates `address`, `paymentAddress`, `publicKey`, `paymentPublicKey`, and `accounts` in the store, and the client sets `provider` + `connected: true`. On failure, the client calls `disconnect()` and re-throws. `isConnecting` is `true` for the duration.

**Throws** `Cannot connect a disposed client`; `Provider not registered: <id>` if the provider isn't registered.

### `disconnect(): void`

Clears all connection state in the store but **preserves** the `hasProvider` install-detection flags (those reflect extension presence, not authorization). Calls the active provider's `disconnect()` hook first.

### `signMessage(message, addressOrOptions?): Promise<string>`

```ts
signMessage(message: string, addressOrOptions?: string | SignMessageOptions): Promise<string>;
```

Signs a message with the connected wallet. The second argument may be a bare address string (shorthand for `{ toSignAddress: address }`) or a full `SignMessageOptions`.

Returns the signature string.

> **Protocol default is provider-specific.** With no `protocol` set, **UniSat** and **OKX** sign with **ECDSA**; **Xverse** signs with **BIP-322**. Pass `{ protocol: BIP322 }` or `{ protocol: ECDSA }` for consistent cross-wallet output. See [Behavioral contracts](#signmessage-protocol-default).

**Throws** `No wallet connected` if nothing is connected; provider-specific rejection errors on user cancel.

### `signPsbt(...)` — two overloads

```ts
signPsbt(options: SignPsbtOptions): Promise<SignPsbtResponse>;
signPsbt(tx: string, finalize?: boolean, broadcast?: boolean): Promise<SignPsbtResponse>;
```

Signs a single PSBT. `tx` may be hex or base64 (auto-detected and transcoded).

| Param | Default | Notes |
|-------|---------|-------|
| `finalize` | `false` | When `false`, the wallet signs but does not finalize — required for partial-sign flows (e.g. marketplace listings). |
| `broadcast` | `false` | See the [finalize × broadcast](#finalize--broadcast) contract below. |
| `inputsToSign` | _auto_ | **Object form only.** The `(tx, finalize, broadcast)` string overload cannot pass `inputsToSign`. When omitted, Xverse auto-derives inputs from the PSBT; UniSat/OKX sign whatever the wallet decides. |

Returns a `SignPsbtResponse` (`SignedPsbt`). At least one of `signedPsbtBase64` / `signedPsbtHex` is always populated; `txId` is set only when a broadcast occurred.

**Throws** `No wallet connected`; provider rejection error on user cancel. For OKX, requesting `finalize && broadcast` when the OKX build lacks `pushPsbt` throws `OKX did not expose pushPsbt; …`.

### `signPsbts(options: SignPsbtsOptions): Promise<SignPsbtsResponse>`

Bulk-signs an array of PSBTs. Where the wallet exposes a native bulk RPC, this is **one wallet prompt for N PSBTs**; otherwise it transparently falls back to a sequential loop (one prompt per PSBT). The response's `signingPath` tells you which path actually ran.

```ts
interface SignPsbtsOptions {
  psbts: string[];                       // hex or base64
  finalize?: boolean;                    // default false
  broadcast?: boolean;                   // default false
  inputsToSign?: BulkInputsToSign;       // flat = applies to all; nested = per-PSBT
  onProgress?: (signedIndex: number, total: number) => void; // fires after each PSBT
}
```

Returns:

```ts
interface SignPsbtsResponse {
  signedPsbts: SignedPsbt[];
  signingPath: 'native' | 'sequential';
}
```

**Throws** `No PSBTs provided` if `psbts` is empty; `No wallet connected`. See [Per-provider reference](#per-provider-reference) for when each wallet falls back to `'sequential'`.

### `pushPsbt(txHexOrBase64: string): Promise<string | undefined>`

Broadcasts a signed transaction or finalized PSBT and returns the txid. Accepts raw signed-tx hex, PSBT hex, or PSBT base64. **Auto-finalizes** a signed-but-not-finalized PSBT before extracting the transaction.

- **Xverse** has no wallet broadcast RPC → broadcasts via mempool.space.
- **UniSat** / **OKX** try the wallet's own `pushPsbt` first, then fall back to mempool.space on error.

**Throws** `No wallet connected`; for `regtest`, `No public broadcast endpoint configured …` (no public mempool endpoint). See [`broadcastTx`](#core-broadcasttx).

### `capabilities(providerId?: ProviderType): WalletCapabilities`

Returns the capability descriptor for `providerId`, or for the currently connected provider if omitted.

**Throws** `No wallet connected and no provider specified` (when omitted and nothing connected); `Provider not registered: <id>`.

---

## Core: stores & state

### `createStores(options?): Stores`

```ts
function createStores(options?: { network?: NetworkType }): Stores;

interface Stores {
  $store: MapStore<WalletStore>;
  $network: WritableAtom<NetworkType>;
}
```

Creates the nanostores a `SighashClient` needs. `$network` defaults to `'mainnet'`.

### `createInitialStore(): WalletStore`

Returns a fresh, disconnected `WalletStore` (all `hasProvider` flags `undefined`, `isInitializing: true`). Used internally by `createStores` and `disconnect`.

### `WalletStore`

The reactive state shape. Read it via `client.$store.get()` or the React hook.

| Field | Type | Meaning |
|-------|------|---------|
| `provider` | `ProviderType \| undefined` | Connected wallet, or `undefined` when disconnected. |
| `address` | `string` | Ordinals (taproot) address. `''` when disconnected. |
| `paymentAddress` | `string` | Payment address. `''` when disconnected. |
| `publicKey` | `string` | Ordinals public key (hex). `''` when disconnected. |
| `paymentPublicKey` | `string` | Payment public key (hex). Needed for nested-segwit. |
| `accounts` | `string[]` | All addresses returned at connect time. |
| `connected` | `boolean` | `true` after `connect()` resolves. |
| `isConnecting` | `boolean` | `true` while a `connect()` is in flight. |
| `isInitializing` | `boolean` | `true` during first-mount provider detection. |
| `hasProvider` | `Record<ProviderType, boolean \| undefined>` | Sync install-detection flags. |

> **Address model:** UniSat and OKX expose a single address used for both `address` and `paymentAddress`. Xverse returns distinct ordinals and payment addresses.

---

## Core: providers

### Factories

```ts
function unisatProvider(config?: UnisatProviderConfig): ProviderFactory;
function xverseProvider(): ProviderFactory;
function okxProvider(): ProviderFactory;
```

Each returns a `ProviderFactory` for `SighashConfig.providers`.

```ts
type ProviderFactory = (
  stores: { $store: MapStore<WalletStore>; $network: WritableAtom<NetworkType> },
  parent: SighashClient,
) => WalletProvider;
```

### `UnisatProviderConfig`

```ts
interface UnisatProviderConfig {
  /** Force one wallet prompt per PSBT even when UniSat's native bulk RPC is available. Default false. */
  forceSequentialBulkSign?: boolean;
}
```

A safety hatch: UniSat's `signPsbts` has historically been reported to finalize PSBTs even when asked not to, which breaks partial-sign flows. sighash always passes `autoFinalized` explicitly to avoid this, but if real-world testing shows finalization despite the explicit option, set `forceSequentialBulkSign: true` to route through the always-correct single-sign loop. This also sets `capabilities.bulkSign` to `'sequential'`.

### `WalletProvider` (abstract)

Base class for every provider. You don't instantiate it directly, but it defines the shared contract and the default `signPsbts` (sequential) and `pushPsbt` (mempool.space) implementations. Concrete classes (`UnisatProvider`, `XverseProvider`, `OkxProvider`) are exported for type narrowing.

Common members: `id`, `capabilities`, `installed` (getter), `initialize()`, `dispose()`, `connect()`, `disconnect()`, `signMessage()`, `signPsbt()`, `signPsbts()`, `pushPsbt()`.

### Provider-only methods: `switchNetwork` / `getNetwork`

These are **not** on `SighashClient` or `WalletProvider` — they live on the concrete provider classes. Reach them via `client.providers[id]` with a cast:

```ts
import { XverseProvider, XVERSE } from '@sighash-dev/core';

const xverse = client.providers[XVERSE] as XverseProvider | undefined;
await xverse?.switchNetwork('testnet');
const net = await xverse?.getNetwork();
```

| Provider | `switchNetwork` | `getNetwork` |
|----------|-----------------|--------------|
| UniSat | ✅ (`switchChain`) | ✅ |
| Xverse | ✅ (`wallet_changeNetwork`) | ✅ |
| OKX | ❌ (UI-only) | ✅ |

`switchNetwork` throws `<Wallet> does not support network: <network>` for unsupported networks (e.g. UniSat + `regtest`).

### `WalletCapabilities`

```ts
interface WalletCapabilities {
  bulkSign: 'native' | 'sequential';
  signMessageProtocols: readonly SigningProtocol[];
  switchNetwork: boolean;
}
```

| Provider | `bulkSign` | `signMessageProtocols` | `switchNetwork` |
|----------|------------|------------------------|-----------------|
| UniSat | `'native'` (or `'sequential'` if `forceSequentialBulkSign`) | `[BIP322, ECDSA]` | `true` |
| Xverse | `'native'` | `[BIP322, ECDSA]` | `true` |
| OKX | `'native'` | `[BIP322, ECDSA]` | `false` |

> `bulkSign: 'native'` is the **advertised** primitive. The actual run may still fall back to `'sequential'` at runtime (e.g. OKX bulk RPC throws, or you passed nested per-PSBT `inputsToSign`). Always read `signingPath` on the response to know what ran.

### `pickItemInputsToSign(inputsToSign, index)`

```ts
function pickItemInputsToSign(
  inputsToSign: BulkInputsToSign | undefined,
  index: number,
): InputToSign[] | undefined;
```

Utility used by the sequential fallback: given a flat `InputToSign[]` returns it for every index; given a nested `InputToSign[][]` returns the slice at `index`.

---

## Core: PSBT options & response types

### `InputToSign`

```ts
interface InputToSign {
  index: number;            // input index in the PSBT
  address: string;          // address that owns the input
  publicKey?: string;       // honored by OKX / UniSat
  sighashTypes?: number[];  // e.g. [0x83] for SIGHASH_SINGLE | ANYONECANPAY
}
```

### `BulkInputsToSign`

```ts
type BulkInputsToSign = InputToSign[] | InputToSign[][];
```

A **flat** array applies to every PSBT in a batch. A **nested** array applies position-by-position (PSBT _i_ gets `inputsToSign[i]`). Passing the nested form forces UniSat/OKX onto the sequential path (their bulk RPCs accept only one shared input set).

### `SignPsbtOptions`

```ts
interface SignPsbtOptions {
  tx: string;               // hex or base64
  finalize?: boolean;       // default false
  broadcast?: boolean;      // default false
  inputsToSign?: InputToSign[];
}
```

### `SignPsbtsOptions`

```ts
interface SignPsbtsOptions {
  psbts: string[];          // hex or base64
  finalize?: boolean;       // default false
  broadcast?: boolean;      // default false
  inputsToSign?: BulkInputsToSign;
  onProgress?: (signedIndex: number, total: number) => void;
}
```

### `SignedPsbt` / `SignPsbtResponse`

```ts
interface SignedPsbt {
  signedPsbtHex?: string;
  signedPsbtBase64?: string;
  txId?: string;            // present only when broadcast occurred
}
type SignPsbtResponse = SignedPsbt;
```

Providers **throw** on user cancellation rather than returning `undefined`. At least one of `signedPsbtBase64` / `signedPsbtHex` is always set.

### `SignPsbtsResponse`

```ts
interface SignPsbtsResponse {
  signedPsbts: SignedPsbt[];
  signingPath: 'native' | 'sequential';
}
```

### `ResolvedPsbt`

```ts
interface ResolvedPsbt {
  tx: string;        // the caller's original input, verbatim
  psbtHex: string;
  psbtBase64: string;
}
```

The shape the client resolves user input into before dispatching to a provider. Returned by [`resolvePsbtFormats`](#resolvepsbtformatstx-resolvedpsbt).

### `WalletProviderSignPsbtOptions` / `WalletProviderSignPsbtsOptions`

Lower-level option shapes passed from the client to providers — relevant only if you implement a custom `WalletProvider`. They extend `ResolvedPsbt` / carry `ResolvedPsbt[]`, with `finalize` and `broadcast` resolved to concrete booleans.

---

## Core: constants

### Wallets

```ts
const UNISAT = 'unisat';
const XVERSE = 'xverse';
const OKX = 'okx';
const PROVIDERS = [UNISAT, XVERSE, OKX] as const;
type ProviderType = (typeof PROVIDERS)[number];
function isProviderType(value: unknown): value is ProviderType;
```

### Networks

```ts
const MAINNET = 'mainnet';
const TESTNET = 'testnet';
const TESTNET4 = 'testnet4';
const SIGNET = 'signet';
const REGTEST = 'regtest';
const NETWORKS = [MAINNET, TESTNET, TESTNET4, SIGNET, REGTEST] as const;
type NetworkType = (typeof NETWORKS)[number];
function isNetworkType(value: unknown): value is NetworkType;
function isMainnet(network: NetworkType): boolean;
function isTestnetLike(network: NetworkType): boolean; // true for anything except mainnet
```

> For `bitcoinjs-lib` address operations, `testnet`, `testnet4`, and `signet` all map to the same `bitcoin.networks.testnet` (they share address prefixes). See [`getBitcoinJsNetwork`](#getbitcoinjsnetworknetwork-bitcoinnetwork).

### Signing protocols

```ts
const BIP322 = 'bip322';
const ECDSA = 'ecdsa';
const SIGNING_PROTOCOLS = [BIP322, ECDSA] as const;
type SigningProtocol = (typeof SIGNING_PROTOCOLS)[number];
function isSigningProtocol(value: unknown): value is SigningProtocol;
```

---

## Core: PSBT helpers

### `deriveInputsToSign(psbtBase64, options): InputToSign[]`

```ts
function deriveInputsToSign(
  psbtBase64: string,
  options: { ordinalsAddress: string; paymentAddress: string; network: NetworkType },
): InputToSign[];
```

Parses a PSBT and returns one `InputToSign` per input whose `witnessUtxo` script pays to the ordinals or payment address. Behavior:

- Inputs without `witnessUtxo` (legacy non-segwit) are attributed to the **payment** address.
- The PSBT input's `sighashType` (if present) is propagated onto the derived `InputToSign.sighashTypes`.
- Inputs whose script can't be decoded to an address are **skipped** (with a `console.warn`), not thrown.

This is what Xverse uses internally when you don't pass an explicit `inputsToSign`. Requires `bitcoinjs-lib`'s ECC to be initialized — `@sighash-dev/core` does this at module load (see [ECC initialization](#ecc-initialization)).

### `inputsToSignRecord(inputs): Record<string, number[]>`

Groups `InputToSign[]` by address into `{ address: number[] }` — the shape sats-connect's modern `request('signPsbt', { signInputs })` expects.

### `toXverseInputsToSign(inputs): XverseInputToSign[]`

```ts
interface XverseInputToSign {
  address: string;
  signingIndexes: number[];
  sigHash?: number;
}
```

Converts to the shape Xverse's legacy `signMultipleTransactions` expects, grouping by address. Xverse supports a single `sigHash` per address group — if inputs for one address carry mixed sighash types, only the first non-`undefined` value is kept.

### `getBitcoinJsNetwork(network): bitcoin.Network`

Maps a `NetworkType` to a `bitcoinjs-lib` `Network`. `testnet` / `testnet4` / `signet` → `bitcoin.networks.testnet`; `regtest` → `bitcoin.networks.regtest`; everything else → `bitcoin.networks.bitcoin`.

---

## Core: encoding helpers

Zero-dependency hex/base64 helpers (no `Buffer` — they use `atob`/`btoa`, so they run unmodified in browsers).

```ts
function isHex(value: string): boolean;       // even length, hex alphabet
function isBase64(value: string): boolean;
function hexToBytes(hex: string): Uint8Array; // throws 'Invalid hex string'
function bytesToHex(bytes: Uint8Array): string;
function bytesToBase64(bytes: Uint8Array): string; // chunked, safe for large PSBTs
function base64ToBytes(b64: string): Uint8Array;    // throws 'Invalid base64 string'
function hexToBase64(hex: string): string;
function base64ToHex(b64: string): string;
```

### `resolvePsbtFormats(tx): ResolvedPsbt`

```ts
function resolvePsbtFormats(tx: string): ResolvedPsbt;
```

Accepts a PSBT as hex or base64 and returns both encodings plus the original input. Hex is checked first (the hex alphabet is a subset of base64's). Does **not** validate the PSBT internally — only that the byte transcoding round-trips.

**Throws** `Invalid PSBT: expected a non-empty string` for empty/non-string input; `Invalid PSBT format: expected hex or base64` otherwise.

---

## Core: `broadcastTx`

```ts
function broadcastTx(input: string, network: NetworkType): Promise<string>;
```

POSTs a signed transaction to mempool.space for `network` and returns the txid. This is the default broadcaster behind `WalletProvider.pushPsbt`.

- **Accepts** raw signed-tx hex (little-endian version prefix `01000000`/`02000000`), PSBT hex (magic `70736274ff…`), or PSBT base64 (`cHNidP8…`). Format is detected by prefix.
- **Auto-finalizes**: if the PSBT is signed but not yet finalized, it calls `finalizeAllInputs()` before extracting the transaction. (sighash signs with `autoFinalized: false` by default, so a fully-signed PSBT handed to `pushPsbt` typically still needs finalizing.)
- **Endpoints:** `mainnet`, `testnet`, `testnet4`, `signet`. **`regtest` is unsupported** (no public endpoint).

**Throws:**
- `No public broadcast endpoint configured for network "regtest". Broadcast via your own data source.`
- `broadcastTx: input is not a recognizable raw signed-tx hex or PSBT (hex/base64).`
- `Broadcast to <url> failed (<status> <statusText>): <body>` on a non-2xx response (e.g. "min relay fee not met").

---

## React: `SighashProvider`

```tsx
interface SighashProviderProps {
  config?: SighashConfig;
  children: ReactNode;
}
function SighashProvider(props: SighashProviderProps): JSX.Element;
```

Creates and owns a `SighashClient`, calls `initialize()` on mount, and `dispose()` on unmount.

- **Auto-registration:** if `config.providers` is omitted, the React provider registers **UniSat, Xverse, and OKX** out of the box (unlike the core client). Pass `config.providers: []` to opt out, or a non-empty array to override.
- **`config` must be stable across renders.** Define it at module scope or `useMemo` it. Passing a fresh object every render disposes and recreates the client each time the parent re-renders.

`'use client'` directive is included, so it works in React Server Component trees.

---

## React: `useSighash`

```ts
function useSighash(): UseSighashValue;
```

Subscribes to the store + network via `useSyncExternalStore` and returns the full wallet state plus bound action methods. **Must be called inside `<SighashProvider>`** (throws otherwise).

```ts
interface UseSighashValue extends WalletStore {
  network: NetworkType;

  // Convenience mirrors of hasProvider:
  hasUnisat: boolean;
  hasXverse: boolean;
  hasOkx: boolean;

  // Underlying client (null until the provider's mount effect runs):
  client: SighashClient | null;

  connect: (provider: ProviderType) => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string, addressOrOptions?: string | SignMessageOptions) => Promise<string>;
  signPsbt: (arg1: string | SignPsbtOptions, finalize?: boolean, broadcast?: boolean) => Promise<SignPsbtResponse>;
  signPsbts: (options: SignPsbtsOptions) => Promise<SignPsbtsResponse>;
  pushPsbt: (txHexOrBase64: string) => Promise<string | undefined>;
}
```

Since `UseSighashValue extends WalletStore`, you also get `provider`, `address`, `paymentAddress`, `publicKey`, `paymentPublicKey`, `accounts`, `connected`, `isConnecting`, `isInitializing`, and `hasProvider` directly.

**Notes & gotchas:**
- `client` is `null` on the very first render (set inside the provider's mount effect). The action methods throw `useSighash(): client is not ready yet — cannot call <method>` if invoked before the client is ready. Guard on `connected` / `client` in event handlers, or read `client.$store.get()` for the freshest state right after a `connect()`.
- `switchNetwork` / `getNetwork` are **not** exposed by the hook — reach them through `client.providers[id]` (see [provider-only methods](#provider-only-methods-switchnetwork--getnetwork)).

---

## React: context & compatibility aliases

```ts
const SighashContext: React.Context<SighashContextValue>;
interface SighashContextValue {
  client: SighashClient | null;
  stores: Stores | null;
}
```

You rarely need the context directly — `useSighash()` reads it for you.

### LaserEyes compatibility aliases

```ts
export { SighashProvider as LaserEyesProvider } from '@sighash-dev/react';
export { useSighash as useLaserEyes } from '@sighash-dev/react';
```

For projects migrating off `@omnisat/lasereyes-react`: a single import-path find/replace gets you running. They are literal re-exports — identical behavior.

### Version constants

```ts
import { SIGHASH_CORE_VERSION } from '@sighash-dev/core';
import { SIGHASH_REACT_VERSION } from '@sighash-dev/react';
```

Resolved from each package's `package.json` at build time.

---

## Behavioral contracts

### `finalize` × `broadcast`

`signPsbt` / `signPsbts` take independent `finalize` and `broadcast` flags (both default `false`). The interaction differs by wallet:

| Wallet | Broadcast trigger | If broadcast requested but not possible |
|--------|-------------------|------------------------------------------|
| UniSat | Broadcasts via the wallet only when **both** `finalize && broadcast` are `true`. | n/a (wallet always has `pushPsbt`). |
| OKX | Broadcasts only when **both** `finalize && broadcast` are `true`. | **Throws** `OKX did not expose pushPsbt; …` (single-sign) if the build lacks `pushPsbt`. |
| Xverse | Passes `broadcast` straight to the wallet's `signPsbt` RPC; the wallet finalizes + broadcasts and returns the txid. Not gated on the `finalize` flag. | n/a. |

> **Consequence:** for UniSat/OKX, `broadcast: true` with `finalize: false` silently does **not** broadcast. If you want a single call to finalize-and-broadcast on those wallets, pass both. Alternatively, sign first (no broadcast) and call `pushPsbt(signed)` afterward — `pushPsbt` auto-finalizes.

For bulk `signPsbts`, **Xverse cannot broadcast in its native path** (`signMultipleTransactions` has no broadcast). Passing `broadcast: true` forces Xverse onto the sequential loop, where each PSBT goes through `signPsbt` (which can broadcast).

### `signingPath`

`SignPsbtsResponse.signingPath` reports what actually happened:
- `'native'` — one wallet prompt covered the whole batch via the wallet's bulk RPC.
- `'sequential'` — one prompt per PSBT (wallet has no bulk RPC, the bulk call failed and we fell back, or you passed nested per-PSBT `inputsToSign`).

Use it to decide whether to show "N prompts coming" hints, and to track which wallets actually deliver the one-prompt UX in your telemetry.

### `signMessage` protocol default

With no explicit `protocol`:

| Wallet | Default protocol |
|--------|------------------|
| UniSat | `ECDSA` (maps to UniSat `ecdsa`) |
| OKX | `ECDSA` (maps to OKX `ecdsa`) |
| Xverse | `BIP322` |

`BIP322` maps to each wallet's `bip322-simple` variant. (The lasereyes OKX implementation inverted this mapping — sighash corrects it: `ECDSA` → `ecdsa`, `BIP322` → `bip322-simple`.) Pass an explicit `protocol` if you need identical output across wallets.

### Auto-finalize on broadcast

`pushPsbt` / `broadcastTx` auto-finalize a signed-but-unfinalized PSBT before extracting the transaction. You do **not** need to pass `finalize: true` to `signPsbt` just to broadcast afterward — sign (partial), then `pushPsbt(result.signedPsbtBase64)`.

### `regtest` broadcasting

There is no public mempool.space endpoint for `regtest`. `pushPsbt` / `broadcastTx` throw on `regtest` — broadcast via your own node/data source for local regtest testing.

### ECC initialization

`@sighash-dev/core` calls `bitcoin.initEccLib(@bitcoinerlab/secp256k1)` at module load (in `lib/psbt.ts`). This is required for `bitcoinjs-lib` 7.x to handle taproot (`bc1p…`) scripts. Without it, address derivation for taproot inputs silently produces no inputs — which manifests downstream as "missing signature" errors. The library handles this for you; no action needed.

### Address model per wallet

- **UniSat / OKX:** one address serves as both `address` (ordinals) and `paymentAddress`.
- **Xverse:** distinct ordinals and payment addresses, with separate public keys.

### React config stability

`<SighashProvider config={…}>` recreates the underlying client whenever `config` (by reference), `network`, or `providers` changes. Keep `config` referentially stable (module scope or `useMemo`).

---

## Per-provider reference

### UniSat

- **Detection:** `window.unisat`.
- **Connect:** `requestAccounts()` + `getPublicKey()`. Single address for ordinals + payment.
- **Bulk sign:** native `unisat.signPsbts` (single shared `toSignInputs`). Falls back to sequential when `forceSequentialBulkSign` is set or when nested per-PSBT `inputsToSign` is passed.
- **`autoFinalized`** is always passed explicitly (UniSat's API defaults it to `true`, which would break partial-sign flows).
- **Network:** `switchNetwork` ✅ (mainnet/testnet/testnet4/signet; **not** regtest), `getNetwork` ✅.
- **Events:** reconnects on `accountsChanged` / `networkChanged`.

### Xverse

- **Detection:** `window.XverseProviders.BitcoinProvider`.
- **Connect:** silent `wallet_getAccount`, falling back to a `wallet_connect` prompt on access-denied. Returns distinct ordinals + payment addresses, and syncs the active network from the wallet.
- **Single sign:** `request('signPsbt', …)` via sats-connect. Auto-derives `inputsToSign` from the PSBT if you don't pass them. Honors `broadcast` directly.
- **Bulk sign:** native `signMultipleTransactions` (legacy API; per-PSBT inputs; **caps at 100 PSBTs**; **no broadcast**). Falls back to sequential when `broadcast: true` or batch > 100. Throws if it can't derive inputs for a PSBT and you didn't pass them explicitly.
- **Broadcast:** no wallet broadcast RPC → mempool.space via the base `pushPsbt`.
- **Network:** `switchNetwork` ✅ (`wallet_changeNetwork`), `getNetwork` ✅.
- **Response normalization:** signed PSBTs are round-tripped through `bitcoinjs-lib` to a canonical byte form (some verifiers reject Xverse's raw key ordering).

### OKX

- **Detection:** `window.okxwallet.bitcoin` (mainnet) / `window.okxwallet.bitcoinTestnet` (testnet-like). The active namespace is resolved per network at call time.
- **Connect:** `connect()`. Single address for ordinals + payment.
- **Single sign:** `signPsbt`. `autoFinalized` always explicit (defaults to `true` otherwise).
- **Bulk sign:** probes `signPsbts` then `signMultiplePsbts`, passing a **per-PSBT options array** (one entry per PSBT — OKX's bulk RPC expects `options.map(...)`, unlike UniSat's single shared options). Falls back to sequential when: nested per-PSBT `inputsToSign`, no bulk method present, or the bulk RPC throws. User-rejection (EIP-1193 code `4001`/`-32000`) surfaces as `User rejected the OKX bulk-sign request`.
- **Broadcast:** wallet `pushPsbt` if present, else mempool.space.
- **Network:** `switchNetwork` ❌ (extension UI only), `getNetwork` ✅ (`livenet`→mainnet, `testnet`→testnet).

---

## Error reference

Exact `Error.message` strings the library throws, by area. User-rejection errors are normalized to readable messages so you can branch on them.

**`SighashClient`**
- `Cannot connect a disposed client`
- `Provider not registered: <id>`
- `No wallet connected`
- `No wallet connected and no provider specified`
- `Client is disposed`
- `No PSBTs provided`

**UniSat**
- `UniSat extension is not installed or not yet injected`
- `UniSat returned no accounts` / `… no public key` / `… no primary account`
- `UniSat returned <n> signed PSBTs for <m> inputs`
- `UniSat returned an empty result at index <i>`
- `UniSat does not support network: <network>`

**Xverse**
- `User cancelled the Xverse connect request`
- `Xverse connect failed: <message>`
- `Xverse did not return both an ordinals and a payment address`
- `No address to sign with — wallet may not be connected`
- `User rejected the message-sign request` / `User rejected the PSBT signing request` / `User cancelled the bulk-sign request`
- `Xverse signMessage failed: <message>` / `Xverse signPsbt failed: <message>` / `Xverse switchNetwork failed: <message>`
- `Xverse does not support network: <network>`
- `Cannot derive inputs to sign for PSBT at index <i>: pass an explicit inputsToSign array`
- `Cannot auto-derive inputsToSign: Xverse is not connected`

**OKX**
- `OKX wallet is not available for network "<network>". Install the OKX extension and switch the wallet to a network sighash supports.`
- `OKX returned an incomplete connect result`
- `OKX did not expose pushPsbt; sign without broadcast and broadcast via your own data source.`
- `User rejected the OKX bulk-sign request`
- `OKX returned an unexpected bulk-sign result: <detail>`
- `OKX returned an empty result at index <i>`

**Broadcast / encoding**
- `No public broadcast endpoint configured for network "<network>". Broadcast via your own data source.`
- `broadcastTx: input is not a recognizable raw signed-tx hex or PSBT (hex/base64).`
- `Broadcast to <url> failed (<status> <statusText>): <body>`
- `Invalid hex string` / `Invalid base64 string`
- `Invalid PSBT: expected a non-empty string` / `Invalid PSBT format: expected hex or base64`

**React**
- `useSighash() must be used inside <SighashProvider>`
- `useSighash(): client is not ready yet — cannot call <method>`
