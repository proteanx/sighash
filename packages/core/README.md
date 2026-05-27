# @sighash-dev/core

Framework-agnostic Bitcoin wallet connector for the ordinals ecosystem. Targets **Xverse**, **UniSat**, and **OKX** — the three actively-maintained wallets — and ships a first-class **bulk PSBT signing** primitive.

```bash
pnpm add @sighash-dev/core nanostores
```

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
const { signedPsbts } = await client.signPsbts({ psbts: [psbt1, psbt2, psbt3] });
```

For React, prefer [`@sighash-dev/react`](../react).

## Key features

- **Native bulk-sign where supported:** UniSat (`signPsbts`), Xverse (`signMultipleTransactions`), OKX (per-PSBT options array). One wallet prompt for N PSBTs.
- **Transparent sequential fallback** when bulk RPCs throw — your call still resolves.
- **`autoFinalized: false` by default** for `signPsbt` / `signPsbts` — partial-sign flows (marketplace listings) work out of the box.
- **`InputToSign` widening** with `publicKey` + `sighashTypes` (e.g. SIGHASH_SINGLE|ACP at `0x83`) for advanced flows.
- **Auto-derive `inputsToSign`** from a PSBT against the connected wallet's addresses, including taproot (ECC initialized at module load).
- **TypeScript-first**, strict types, minimal public surface.

## License

[MIT](./LICENSE)
