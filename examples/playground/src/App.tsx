import {
  OKX,
  type ProviderType,
  SIGHASH_CORE_VERSION,
  type SighashConfig,
  UNISAT,
  XVERSE,
  okxProvider,
  unisatProvider,
  xverseProvider,
} from '@sighash/core';
import { SIGHASH_REACT_VERSION, SighashProvider, useSighash } from '@sighash/react';
import { useState } from 'react';

const SIGHASH_CONFIG: SighashConfig = {
  network: 'mainnet',
  providers: [unisatProvider(), xverseProvider(), okxProvider()],
};

export function App() {
  return (
    <SighashProvider config={SIGHASH_CONFIG}>
      <Playground />
    </SighashProvider>
  );
}

// Minimally well-formed PSBT (psbt magic + empty unsigned tx) — used only to exercise
// the request/response wiring end-to-end. Not signable.
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
    hasXverse,
    hasOkx,
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

  const capabilities = connected && provider ? client?.capabilities(provider) : undefined;

  const wrap = (fn: () => Promise<void>) => async () => {
    setLastError(null);
    try {
      await fn();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleConnect = (target: ProviderType) =>
    wrap(async () => {
      await connect(target);
    });

  const handleSignMessage = wrap(async () => {
    setLastSignature(null);
    const sig = await signMessage('hello from sighash playground');
    setLastSignature(sig);
  });

  const handleBulkSign = wrap(async () => {
    setBulkResult(null);
    setBulkProgress({ done: 0, total: 3 });
    const result = await signPsbts({
      psbts: [SAMPLE_PSBT_HEX, SAMPLE_PSBT_HEX, SAMPLE_PSBT_HEX],
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
          <Row label="hasXverse" value={String(hasXverse)} />
          <Row label="hasOkx" value={String(hasOkx)} />
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
        <h2 style={styles.h2}>Connect</h2>
        <div style={styles.row}>
          {connected ? (
            <button type="button" onClick={disconnect} style={styles.button}>
              Disconnect ({provider})
            </button>
          ) : (
            <>
              <ConnectButton
                label="UniSat"
                installed={hasUnisat}
                onConnect={handleConnect(UNISAT)}
                disabled={isConnecting}
                installUrl="https://unisat.io/download"
              />
              <ConnectButton
                label="Xverse"
                installed={hasXverse}
                onConnect={handleConnect(XVERSE)}
                disabled={isConnecting}
                installUrl="https://www.xverse.app/download"
              />
              <ConnectButton
                label="OKX"
                installed={hasOkx}
                onConnect={handleConnect(OKX)}
                disabled={isConnecting}
                installUrl="https://www.okx.com/web3"
              />
            </>
          )}
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>Actions</h2>
        <div style={styles.row}>
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
            title="Bulk-sign 3 PSBTs with finalize: false"
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
            <strong>Bulk signed:</strong> {bulkResult} PSBTs returned via{' '}
            {capabilities?.bulkSign === 'native' ? 'native bulk RPC' : 'sequential fallback'}
          </p>
        )}
      </section>
    </main>
  );
}

function ConnectButton({
  label,
  installed,
  onConnect,
  disabled,
  installUrl,
}: {
  label: string;
  installed: boolean;
  onConnect: () => Promise<void>;
  disabled?: boolean;
  installUrl: string;
}) {
  if (!installed) {
    return (
      <a href={installUrl} style={styles.installLink} target="_blank" rel="noopener noreferrer">
        Install {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onConnect} disabled={disabled} style={styles.button}>
      Connect {label}
    </button>
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
  installLink: {
    padding: '8px 16px',
    background: '#f5f5f5',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 14,
    textDecoration: 'none',
  },
  result: { marginTop: 12, fontSize: 13, fontFamily: 'ui-monospace, monospace' },
};
