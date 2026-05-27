---
"@sighash-dev/core": minor
"@sighash-dev/react": minor
---

Initial public release.

- Framework-agnostic `SighashClient` plus React `<SighashProvider>` / `useSighash()`.
- Wallet providers for UniSat, Xverse, and OKX with auto-detection and connect/disconnect lifecycle.
- `signPsbt`, `signMessage`, and `pushPsbt` per-wallet implementations.
- **Bulk PSBT signing (`signPsbts`)** with native single-prompt paths on each wallet and transparent sequential fallback when the wallet's bulk RPC isn't available or errors out.
- `SignPsbtsResponse.signingPath: 'native' | 'sequential'` tells consumers which path actually ran.
- `autoFinalized: false` default for both `signPsbt` and `signPsbts` to keep partial-sign flows (marketplace listings) working.
- Auto-derived `inputsToSign` from a PSBT against the connected wallet's addresses, with taproot support (ECC initialized at module load).
- LaserEyes compatibility aliases (`LaserEyesProvider`, `useLaserEyes`) for projects swapping in from `@omnisat/lasereyes-*`.
