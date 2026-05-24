import { SIGHASH_CORE_VERSION, type SighashConfig, UNISAT, unisatProvider } from '@sighash/core';
import { SIGHASH_REACT_VERSION, SighashProvider, useSighash } from '@sighash/react';
import { useState } from 'react';

const SIGHASH_CONFIG: SighashConfig = {
  network: 'mainnet',
  providers: [unisatProvider()],
};

export function App() {
  return (
    <SighashProvider config={SIGHASH_CONFIG}>
      <Playground />
    </SighashProvider>
  );
}

// PSBT magic (`psbt\xff`) + unsigned-tx header that's minimally well-formed enough for
// UniSat's RPC to accept and round-trip in dev. Not signable — used only to exercise
// our request/response wiring end-to-end in the playground.
const SAMPLE_PSBT_HEX = '70736274ff01000000000000000000';

function Playground() {
  const {
    isInitializing,
    isConnecting,
    connected,
    provider,
    address,
    paymentAddress,
    publicKey,
    paymentPublicKey,
    network,
    hasUnisat,
    client,
    connect,
    disconnect,
    signMessage,
    signPsbts,
  } = useSighash();

  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<number | null>(null);

  const capabilities = connected ? client?.capabilities(UNISAT) : undefined;

  const wrap = (fn: () => Promise<void>) => async () => {
    setLastError(null);
    try {
      await fn();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleConnect = wrap(async () => {
    await connect(UNISAT);
  });

  const handleSignMessage = wrap(async () => {
    setLastSignature(null);
    const sig = await signMessage('hello from sighash playground');
    setLastSignature(sig);
  });

  const handleBulkSign = wrap(async () => {
    setBulkResult(null);
    setBulkProgress({ done: 0, total: 3 });
    const psbts = [SAMPLE_PSBT_HEX, SAMPLE_PSBT_HEX, SAMPLE_PSBT_HEX];
    const result = await signPsbts({
      psbts,
      // Default: finalize: false — bulk-signed PSBTs come back unfinalized, matching the
      // single-sign behavior so partial-sign flows (e.g. marketplace listings) work.
      onProgress: (done, total) => setBulkProgress({ done, total }),
    });
    setBulkResult(result.signedPsbts.length);
  });

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>sighash playground</h1>
        <p style={styles.subtitle}>
          @sighash/core {SIGHASH_CORE_VERSION} · @sighash/react {SIGHASH_REACT_VERSION}
        </p>
      </header>

      <section style={styles.section}>
        <h2 style={styles.h2}>Store</h2>
        <dl style={styles.dl}>
          <Row label="isInitializing" value={String(isInitializing)} />
          <Row label="isConnecting" value={String(isConnecting)} />
          <Row label="connected" value={String(connected)} />
          <Row label="provider" value={provider ?? '—'} />
          <Row label="network" value={network} />
          <Row label="hasUnisat" value={String(hasUnisat)} />
          <Row label="address" value={address || '—'} />
          <Row label="paymentAddress" value={paymentAddress || '—'} />
          <Row label="publicKey" value={publicKey ? `${publicKey.slice(0, 16)}…` : '—'} />
          <Row
            label="paymentPublicKey"
            value={paymentPublicKey ? `${paymentPublicKey.slice(0, 16)}…` : '—'}
          />
          {capabilities && (
            <>
              <Row label="capabilities.bulkSign" value={capabilities.bulkSign} />
              <Row
                label="capabilities.signMessageProtocols"
                value={capabilities.signMessageProtocols.join(', ')}
              />
              <Row label="capabilities.switchNetwork" value={String(capabilities.switchNetwork)} />
            </>
          )}
        </dl>
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>Actions</h2>
        <div style={styles.row}>
          {connected ? (
            <button type="button" onClick={disconnect} style={styles.button}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting || !hasUnisat}
              style={styles.button}
            >
              {isConnecting ? 'Connecting…' : hasUnisat ? 'Connect UniSat' : 'UniSat not detected'}
            </button>
          )}

          <button
            type="button"
            onClick={handleSignMessage}
            disabled={!connected}
            style={styles.button}
          >
            Sign message (ECDSA)
          </button>

          <button
            type="button"
            onClick={handleBulkSign}
            disabled={!connected}
            style={styles.button}
            title="Calls signPsbts with finalize: false — partial signatures preserved."
          >
            Sign 3 PSBTs (bulk, no finalize)
          </button>
        </div>

        {lastError && (
          <p style={{ ...styles.result, color: '#c00' }}>
            <strong>Error:</strong> <code>{lastError}</code>
          </p>
        )}

        {lastSignature && (
          <p style={styles.result}>
            <strong>Last signature:</strong> <code>{lastSignature}</code>
          </p>
        )}

        {bulkProgress && bulkResult === null && (
          <p style={styles.result}>
            Signing {bulkProgress.done} / {bulkProgress.total}…
          </p>
        )}

        {bulkResult !== null && (
          <p style={styles.result}>
            <strong>Bulk signed:</strong> {bulkResult} PSBTs returned (single wallet prompt via
            UniSat native bulk RPC)
          </p>
        )}
      </section>

      {!hasUnisat && (
        <section style={styles.section}>
          <p style={styles.note}>
            UniSat extension not detected. Install from{' '}
            <a href="https://unisat.io/download" style={styles.link}>
              unisat.io/download
            </a>{' '}
            and refresh.
          </p>
        </section>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.dlRow}>
      <dt style={styles.dt}>{label}</dt>
      <dd style={styles.dd}>{value}</dd>
    </div>
  );
}

const styles = {
  main: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: 32,
    maxWidth: 720,
    margin: '0 auto',
    color: '#1a1a1a',
  },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 600, margin: 0 },
  subtitle: { fontSize: 13, color: '#666', margin: '4px 0 0' },
  section: { marginBottom: 32 },
  h2: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
  dl: { display: 'grid', gridTemplateColumns: '1fr', gap: 4 },
  dlRow: {
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    gap: 12,
    fontSize: 13,
    fontFamily: 'ui-monospace, monospace',
  },
  dt: { color: '#666' },
  dd: { margin: 0, wordBreak: 'break-all' as const },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' as const },
  button: {
    padding: '8px 16px',
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  },
  result: { marginTop: 12, fontSize: 13, fontFamily: 'ui-monospace, monospace' },
  note: { fontSize: 13, color: '#666', background: '#f5f5f5', padding: 16, borderRadius: 6 },
  link: { color: '#1a1a1a' },
};
