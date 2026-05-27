# Contributing to sighash

Thanks for your interest in `sighash`. The repo is in active early development — the build plan is in [`PLAN.md`](./PLAN.md) and the public API will evolve until `1.0`.

## Prerequisites

- **Node.js ≥ 24.** Install via [`nvm`](https://github.com/nvm-sh/nvm): `nvm install 24 && nvm use 24`. The repo ships an `.nvmrc`, so `nvm use` is enough once you're in the directory.
- **pnpm 11.** Enable via `corepack enable` — pnpm 11 will be activated automatically from `package.json#packageManager`.
- **`minimum-release-age` recommended.** We protect against supply-chain attacks by refusing to install packages younger than 7 days. To enable globally:

  ```bash
  mkdir -p ~/.config/pnpm
  echo "minimum-release-age=10080" >> ~/.config/pnpm/rc
  ```

## Workflow

1. Fork or branch from `main`.
2. `pnpm install`
3. Make your change.
4. `pnpm lint && pnpm typecheck && pnpm build && pnpm test` must pass.
5. **Add a changeset** for any user-facing change:

   ```bash
   pnpm changeset
   ```

   Pick the affected packages and a semver bump. Commit the generated `.changeset/*.md` with your changes.

6. Open a PR. CI runs lint + typecheck + build + test.

## Coding style

- Formatter and linter: [Biome](https://biomejs.dev). Config in `biome.json`.
- TypeScript everywhere, `strict: true`. No `// @ts-ignore` without a comment explaining why.
- Prefer named exports. Avoid default exports for non-React-component modules.

## Adding dependencies

- Every dep must satisfy the `minimum-release-age=10080` policy (≥ 7 days old).
- Prefer adding to a single package; only put it in the catalog (`pnpm-workspace.yaml`) if two or more packages need it.
- For runtime deps in `@sighash-dev/core` and `@sighash-dev/react`, weigh bundle size carefully — these are consumer libraries.

## Reporting bugs

Open an issue with a minimal reproduction. For wallet-flow bugs, include:

- Wallet name + version (Xverse / UniSat / OKX).
- Network (mainnet / testnet / signet / regtest).
- Operation (connect, signMessage, signPsbt, signPsbts, pushPsbt).
- Console errors and (if available) the PSBT base64.

## Security

See [SECURITY.md](./SECURITY.md). Please do **not** open public issues for vulnerabilities.
