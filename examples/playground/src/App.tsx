import { SIGHASH_CORE_VERSION } from '@sighash/core';
import { SIGHASH_REACT_VERSION } from '@sighash/react';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>sighash playground</h1>
      <p>Scaffold smoke test. Real wallet flows land in later phases — see PLAN.md.</p>
      <ul>
        <li>
          <code>@sighash/core</code>: {SIGHASH_CORE_VERSION}
        </li>
        <li>
          <code>@sighash/react</code>: {SIGHASH_REACT_VERSION}
        </li>
      </ul>
    </main>
  );
}
