# sighash

Open-source Bitcoin wallet connector for the ordinals ecosystem.

`sighash` is the wallet library powering [ARKAiD](https://arkaid.io) and [ord-x](https://ord-x.com). It targets **Xverse**, **UniSat**, and **OKX** — the three actively-maintained wallets in the ordinals ecosystem today — and ships a first-class **bulk PSBT signing** primitive (`signPsbts`).

> **Status:** 0.1.0 — used in production by [ARKAiD](https://arkaid.io). API may still shift before 1.0.

## Packages

| Package                              | Description                                  |
| ------------------------------------ | -------------------------------------------- |
| [`@sighash-dev/core`](./packages/core)   | Framework-agnostic wallet client + providers |
| [`@sighash-dev/react`](./packages/react) | React provider + `useSighash()` hook         |

## Documentation

- **[API reference](./docs/API.md)** — full contracts for every export: signatures, defaults, errors, and per-wallet behavior.

## Why sighash?

- Existing libraries are lacking features needed for enterprise level production.
- I (Proteus) am tired of building a new wallet connector per app and needed something I can use across platform builds and decided to share with whomever might find it useful.
- Three wallets, well-supported, instead of fifteen with varying degrees of maintenance.
- TypeScript-first with a strict, minimal public surface.
- Drop-in (or near drop-in) replacement for LaserEyes consumers.

## Requirements

- **Node.js** ≥ 24 (install via [`nvm`](https://github.com/nvm-sh/nvm))
- **pnpm** ≥ 11 (auto-installed via `corepack enable`)
- A `pnpm` global config with `minimum-release-age` set (recommended for supply-chain protection)

## Local development

```bash
nvm use         # picks up Node 24 from .nvmrc
corepack enable # provisions pnpm 11.x from the packageManager field
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## Project layout

```
sighash/
├── packages/
│   ├── core/       # @sighash-dev/core — framework-agnostic
│   └── react/      # @sighash-dev/react — React bindings
├── examples/
│   └── playground/ # local Vite + React app for manual testing
├── PLAN.md         # phased build plan
└── README.md
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
