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
} from '@sighash-dev/core';
import { SIGHASH_REACT_VERSION, SighashProvider, useSighash } from '@sighash-dev/react';
import { useState } from 'react';
import {
  type SignedPsbtSummary,
  buildListingFixturePsbt,
  summarizeSignedPsbt,
} from './listing-fixture';

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
    signPsbt,
    signPsbts,
  } = useSighash();

  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [singleSignResult, setSingleSignResult] = useState<
    SignedPsbtSummary | { error: string } | null
  >(null);
  const [bulkSignResults, setBulkSignResults] = useState<Array<
    SignedPsbtSummary | { error: string }
  > | null>(null);
  const [bulkSignPath, setBulkSignPath] = useState<'native' | 'sequential' | null>(null);

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

  const buildFixturePsbt = () =>
    buildListingFixturePsbt({
      ordinalsAddress: address,
      paymentAddress,
      ordinalsPublicKey: publicKey,
    });

  const handleSignListing = wrap(async () => {
    setSingleSignResult(null);
    const psbtBase64 = buildFixturePsbt();
    const result = await signPsbt(psbtBase64);
    if (!result?.signedPsbtBase64) {
      setSingleSignResult({ error: 'No signedPsbtBase64 in response' });
      return;
    }
    setSingleSignResult(summarizeSignedPsbt(result.signedPsbtBase64));
  });

  const handleBulkSign = wrap(async () => {
    setBulkSignResults(null);
    setBulkSignPath(null);
    setBulkProgress({ done: 0, total: 3 });
    const psbts = [buildFixturePsbt(), buildFixturePsbt(), buildFixturePsbt()];
    const result = await signPsbts({
      psbts,
      onProgress: (done, total) => setBulkProgress({ done, total }),
    });
    setBulkSignPath(result.signingPath);
    setBulkSignResults(
      result.signedPsbts.map((s) => summarizeSignedPsbt(s.signedPsbtBase64 ?? '')),
    );
  });

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>sighash playground</h1>
        <p style={styles.subtitle}>
          @sighash-dev/core {SIGHASH_CORE_VERSION} · @sighash-dev/react {SIGHASH_REACT_VERSION}
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
            onClick={handleSignListing}
            disabled={!connected}
            style={styles.button}
            title="Sign a single listing-shaped PSBT (sighashType=0x83, fake outpoint, real wallet address). Verifies tapKeySig lands on input 0."
          >
            Sign listing PSBT
          </button>

          <button
            type="button"
            onClick={handleBulkSign}
            disabled={!connected}
            style={styles.button}
            title="Bulk-sign 3 listing-shaped PSBTs with finalize: false"
          >
            Sign 3 listing PSBTs (bulk)
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

        {bulkProgress && bulkSignResults === null && (
          <p style={styles.result}>
            Signing {bulkProgress.done} / {bulkProgress.total}…
          </p>
        )}

        {singleSignResult && (
          <div style={styles.result}>
            <strong>Single listing-sign result:</strong>
            <pre style={styles.pre}>{JSON.stringify(singleSignResult, null, 2)}</pre>
          </div>
        )}

        {bulkSignResults && (
          <div style={styles.result}>
            <strong>
              Bulk listing-sign result ({bulkSignResults.length} PSBTs · actually ran via{' '}
              <code>{bulkSignPath ?? 'unknown'}</code>
              {capabilities && bulkSignPath && capabilities.bulkSign !== bulkSignPath && (
                <span style={{ color: '#c80' }}>
                  {' '}
                  (capabilities advertised <code>{capabilities.bulkSign}</code>; runtime fell back)
                </span>
              )}
              ):
            </strong>
            <pre style={styles.pre}>{JSON.stringify(bulkSignResults, null, 2)}</pre>
          </div>
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
  pre: {
    background: '#f5f5f5',
    padding: 12,
    borderRadius: 6,
    fontSize: 12,
    overflowX: 'auto' as const,
    margin: '6px 0 0',
  },
};
