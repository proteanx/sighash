import { SIGHASH_CORE_VERSION, type SighashConfig, UNISAT } from '@sighash/core';
import { SIGHASH_REACT_VERSION, SighashProvider, useSighash } from '@sighash/react';
import { useState } from 'react';
import { mockProvider } from './mock-provider';

const SIGHASH_CONFIG: SighashConfig = {
  network: 'mainnet',
  providers: [mockProvider],
};

export function App() {
  return (
    <SighashProvider config={SIGHASH_CONFIG}>
      <Playground />
    </SighashProvider>
  );
}

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
    connect,
    disconnect,
    signMessage,
    signPsbts,
  } = useSighash();

  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<number | null>(null);

  const handleSignMessage = async () => {
    setLastSignature(null);
    const sig = await signMessage('hello from sighash playground');
    setLastSignature(sig);
  };

  const handleBulkSign = async () => {
    setBulkResult(null);
    setBulkProgress({ done: 0, total: 3 });
    const psbts = [SAMPLE_PSBT_HEX, SAMPLE_PSBT_HEX, SAMPLE_PSBT_HEX];
    const result = await signPsbts({
      psbts,
      onProgress: (done, total) => setBulkProgress({ done, total }),
    });
    setBulkResult(result.signedPsbts.length);
  };

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
              onClick={() => connect(UNISAT)}
              disabled={isConnecting}
              style={styles.button}
            >
              {isConnecting ? 'Connecting…' : 'Connect (Mock UniSat)'}
            </button>
          )}

          <button
            type="button"
            onClick={handleSignMessage}
            disabled={!connected}
            style={styles.button}
          >
            Sign message
          </button>

          <button
            type="button"
            onClick={handleBulkSign}
            disabled={!connected}
            style={styles.button}
          >
            Sign 3 PSBTs (sequential bulk)
          </button>
        </div>

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
            <strong>Bulk signed:</strong> {bulkResult} PSBTs returned
          </p>
        )}
      </section>
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
    gridTemplateColumns: '180px 1fr',
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
};
