# @sighash-dev/react

React bindings for [`@sighash-dev/core`](../core). Exposes a `<SighashProvider>` and a `useSighash()` hook that mirror the `LaserEyesProvider` / `useLaserEyes` surface — drop-in for projects migrating off `@omnisat/lasereyes-react`.

```bash
pnpm add @sighash-dev/react @sighash-dev/core nanostores react
```

```tsx
import { SighashProvider, useSighash } from '@sighash-dev/react';
import { UNISAT, XVERSE, OKX } from '@sighash-dev/core';

function App() {
  return (
    <SighashProvider config={{ network: 'mainnet' }}>
      <Wallet />
    </SighashProvider>
  );
}

function Wallet() {
  const { connect, address, signPsbts } = useSighash();
  // ...
}
```

The three built-in providers (UniSat, Xverse, OKX) are auto-registered when `config.providers` is omitted.

**[Full API reference →](../../docs/API.md)** — `useSighash()` return shape, `SighashProvider` props, and the core contracts re-exported through this package.

## Compatibility aliases

For projects swapping in from lasereyes:

```tsx
import { LaserEyesProvider, useLaserEyes } from '@sighash-dev/react';
// equivalent to SighashProvider / useSighash
```

The aliases let you do a single import-path find/replace and keep the rest of your code unchanged.

## License

[MIT](./LICENSE)
