import type { NetworkType, ProviderType, SighashClient } from '@sighash-dev/core';
import { type CSSProperties, useCallback, useMemo, useState } from 'react';
import type { BuildCtx } from './builders';
import { bytesToHex, generatePlatformKey, platformKeyFromHex } from './crypto';
import { type SelfTestRow, runSelfTest } from './self-test';
import {
  TRACK_B_TESTS,
  type TestRunResult,
  type TrackBTest,
  createBuildCtx,
  runTrackBTest,
} from './track-b';

const STORAGE_KEY = 'sighash-playground-platform-priv';

export interface TrackBPanelProps {
  connected: boolean;
  provider: ProviderType | undefined;
  network: NetworkType;
  ordinalsAddress: string;
  ordinalsPublicKey: string;
  paymentAddress: string;
  paymentPublicKey: string;
  client: SighashClient | null;
}

interface RealPrevoutForm {
  enabled: boolean;
  txid: string;
  vout: string;
  value: string;
}

export function TrackBPanel(props: TrackBPanelProps) {
  const [platformPrivHex, setPlatformPrivHex] = useState<string>(loadOrCreatePlatformKey);
  const [prevout, setPrevout] = useState<RealPrevoutForm>({
    enabled: false,
    txid: '',
    vout: '0',
    value: '546',
  });
  const [results, setResults] = useState<Record<string, TestRunResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestRow[] | null>(null);

  const platformXOnly = useMemo(() => {
    try {
      return platformKeyFromHex(platformPrivHex).xOnly;
    } catch {
      return undefined;
    }
  }, [platformPrivHex]);

  const realPrevout = useMemo(() => parsePrevout(prevout), [prevout]);

  const ctxResult = useMemo<{ ctx?: BuildCtx; error?: string }>(() => {
    if (!props.connected || !platformXOnly) return {};
    if (!props.ordinalsPublicKey || !props.ordinalsAddress || !props.paymentAddress) {
      return {
        error: 'Connected wallet did not expose all of ordinals address/pubkey + payment address',
      };
    }
    try {
      const ctx = createBuildCtx({
        network: props.network,
        ordinalsAddress: props.ordinalsAddress,
        ordinalsPublicKeyHex: props.ordinalsPublicKey,
        paymentAddress: props.paymentAddress,
        paymentPublicKeyHex: props.paymentPublicKey,
        platformXOnly,
        ...(realPrevout.ok && realPrevout.value ? { realPrevout: realPrevout.value } : {}),
      });
      return { ctx };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [
    props.connected,
    props.network,
    props.ordinalsAddress,
    props.ordinalsPublicKey,
    props.paymentAddress,
    props.paymentPublicKey,
    platformXOnly,
    realPrevout,
  ]);

  const regenerate = useCallback(() => {
    const key = generatePlatformKey();
    const hex = bytesToHex(key.privateKey);
    localStorage.setItem(STORAGE_KEY, hex);
    setPlatformPrivHex(hex);
    setResults({});
  }, []);

  const runTest = useCallback(
    async (test: TrackBTest) => {
      const ctx = ctxResult.ctx;
      if (!ctx || !props.provider || !props.client) return;
      setRunning(test.id);
      try {
        const result = await runTrackBTest(test, ctx, { client: props.client });
        setResults((prev) => ({ ...prev, [test.id]: result }));
      } finally {
        setRunning(null);
      }
    },
    [ctxResult.ctx, props.provider, props.client],
  );

  const runAll = useCallback(async () => {
    const ctx = ctxResult.ctx;
    if (!ctx || !props.provider || !props.client) return;
    const deps = { client: props.client };
    for (const test of TRACK_B_TESTS) {
      setRunning(test.id);
      const result = await runTrackBTest(test, ctx, deps);
      setResults((prev) => ({ ...prev, [test.id]: result }));
    }
    setRunning(null);
  }, [ctxResult.ctx, props.provider, props.client]);

  const selfTestBox = (
    <div style={styles.configBox}>
      <div style={styles.configRow}>
        <button type="button" onClick={() => setSelfTest(runSelfTest())} style={styles.smallButton}>
          Run harness self-test (local signer, no wallet)
        </button>
        <span style={styles.muted}>
          Signs every PSBT with a local key through the same verify path. All rows should PASS —
          confirms the harness itself is correct before you blame a wallet.
        </span>
      </div>
      {selfTest?.map((row) => (
        <div key={row.name} style={styles.assertion}>
          <span style={{ color: row.ok ? '#0a0' : '#c00' }}>{row.ok ? '✓' : '✗'}</span>{' '}
          <span style={styles.assertionLabel}>{row.name}</span>
          {!row.ok && <span style={styles.assertionReason}>{row.detail}</span>}
        </div>
      ))}
    </div>
  );

  if (!props.connected) {
    return (
      <section style={styles.section}>
        <h2 style={styles.h2}>Option C — Track B (wallet signing gates)</h2>
        {selfTestBox}
        <p style={styles.muted}>Connect a wallet to run the Track B signing capability tests.</p>
      </section>
    );
  }

  const busy = running !== null;

  return (
    <section style={styles.section}>
      <h2 style={styles.h2}>Option C — Track B (wallet signing gates)</h2>
      <p style={styles.muted}>
        Sign-and-verify only — no broadcast. Each test builds the PSBT, has{' '}
        <strong>{props.provider}</strong> sign it, then verifies the signature against the
        BIP341/342 sighash. Reconnect a different wallet and re-run to fill the doc's matrix.
      </p>

      {selfTestBox}

      <div style={styles.configBox}>
        <div style={styles.configRow}>
          <span style={styles.configLabel}>platform_xonly</span>
          <code style={styles.code}>
            {platformXOnly ? bytesToHex(platformXOnly) : '— invalid platform key —'}
          </code>
          <button type="button" onClick={regenerate} style={styles.smallButton} disabled={busy}>
            Regenerate
          </button>
        </div>
        <div style={styles.configRow}>
          <span style={styles.configLabel}>passthrough</span>
          <code style={styles.code}>{ctxResult.ctx?.passthrough.address ?? '—'}</code>
          {ctxResult.ctx && (
            <span style={styles.kindBadge}>buyer: {ctxResult.ctx.paymentKind}</span>
          )}
        </div>

        <div style={styles.configRow}>
          <label style={styles.configLabel}>
            <input
              type="checkbox"
              checked={prevout.enabled}
              onChange={(e) => setPrevout((p) => ({ ...p, enabled: e.target.checked }))}
            />{' '}
            real prevout
          </label>
          <input
            style={styles.input}
            placeholder="funded txid (B1b/B2 only)"
            value={prevout.txid}
            disabled={!prevout.enabled}
            onChange={(e) => setPrevout((p) => ({ ...p, txid: e.target.value.trim() }))}
          />
          <input
            style={styles.inputSmall}
            placeholder="vout"
            value={prevout.vout}
            disabled={!prevout.enabled}
            onChange={(e) => setPrevout((p) => ({ ...p, vout: e.target.value.trim() }))}
          />
          <input
            style={styles.inputSmall}
            placeholder="sats"
            value={prevout.value}
            disabled={!prevout.enabled}
            onChange={(e) => setPrevout((p) => ({ ...p, value: e.target.value.trim() }))}
          />
        </div>
        {prevout.enabled && !realPrevout.ok && (
          <p style={styles.warn}>Invalid prevout: {realPrevout.error}</p>
        )}
        {!prevout.enabled && (
          <p style={styles.muted}>
            No real prevout → B1b runs with a phantom outpoint, so it won't distinguish from B1d.
          </p>
        )}
      </div>

      {ctxResult.error && (
        <p style={styles.error}>
          <strong>Cannot build tests:</strong> <code>{ctxResult.error}</code>
        </p>
      )}

      <div style={styles.actions}>
        <button
          type="button"
          onClick={runAll}
          style={styles.button}
          disabled={busy || !ctxResult.ctx}
          title="Runs every test in order — expect one or more wallet approvals per test."
        >
          Run all (≫ many prompts)
        </button>
      </div>

      <div style={styles.table}>
        {TRACK_B_TESTS.map((test) => (
          <TestRow
            key={test.id}
            test={test}
            result={results[test.id]}
            running={running === test.id}
            disabled={busy || !ctxResult.ctx}
            onRun={() => runTest(test)}
          />
        ))}
      </div>
    </section>
  );
}

function TestRow(props: {
  test: TrackBTest;
  result: TestRunResult | undefined;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  const { test, result, running } = props;
  return (
    <div style={styles.row}>
      <div style={styles.rowHead}>
        <button
          type="button"
          onClick={props.onRun}
          style={styles.runButton}
          disabled={props.disabled}
        >
          {running ? '…' : 'Run'}
        </button>
        <code style={styles.testId}>{test.id}</code>
        <span style={styles.testLabel}>{test.label}</span>
        <span style={{ ...styles.gate, ...gateStyle(test.gate) }}>{test.gate}</span>
        {test.masterGate && <span style={styles.master}>MASTER</span>}
        {test.nonFatal && <span style={styles.nonFatal}>non-fatal</span>}
        <span style={styles.status}>{statusLabel(result, running)}</span>
      </div>
      {result?.signingPath && (
        <p style={styles.pathNote}>
          batch signing path: <code>{result.signingPath}</code>
          {result.signingPath === 'sequential' && ' (N prompts — degraded but functional)'}
        </p>
      )}
      {result?.error && (
        <p style={styles.error}>
          <code>{result.error}</code>
        </p>
      )}
      {result?.assertions.map((a, i) => (
        <div key={`${test.id}-${i}`} style={styles.assertion}>
          <span style={{ color: a.outcome.ok ? '#0a0' : '#c00' }}>{a.outcome.ok ? '✓' : '✗'}</span>{' '}
          <span style={styles.assertionLabel}>{a.label}</span>
          <span style={styles.assertionReason}>{a.outcome.reason}</span>
        </div>
      ))}
    </div>
  );
}

function statusLabel(result: TestRunResult | undefined, running: boolean): string {
  if (running) return 'running…';
  if (!result) return '—';
  if (result.error) return 'ERROR';
  return result.ok ? 'PASS' : 'FAIL';
}

function gateStyle(gate: string): CSSProperties {
  if (gate === 'C-ONLY') return { background: '#e6f0ff', color: '#1452cc' };
  if (gate === 'SHARED+C') return { background: '#efe6ff', color: '#6a1bcc' };
  return { background: '#e9f7e9', color: '#1a7a1a' };
}

function loadOrCreatePlatformKey(): string {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (saved) {
    try {
      platformKeyFromHex(saved);
      return saved;
    } catch {
      // fall through and regenerate
    }
  }
  const hex = bytesToHex(generatePlatformKey().privateKey);
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, hex);
  return hex;
}

interface ParsedPrevout {
  ok: boolean;
  error?: string;
  value?: { txid: string; vout: number; valueSats: number };
}

function parsePrevout(form: RealPrevoutForm): ParsedPrevout {
  if (!form.enabled) return { ok: false };
  if (!/^[0-9a-fA-F]{64}$/.test(form.txid))
    return { ok: false, error: 'txid must be 64 hex chars' };
  const vout = Number(form.vout);
  if (!Number.isInteger(vout) || vout < 0)
    return { ok: false, error: 'vout must be a non-negative integer' };
  const valueSats = Number(form.value);
  if (!Number.isInteger(valueSats) || valueSats <= 0)
    return { ok: false, error: 'value must be a positive integer (sats)' };
  return { ok: true, value: { txid: form.txid.toLowerCase(), vout, valueSats } };
}

const styles: Record<string, CSSProperties> = {
  section: { marginBottom: 32 },
  h2: { fontSize: 16, fontWeight: 600, marginBottom: 8 },
  muted: { fontSize: 12, color: '#666', margin: '4px 0' },
  warn: { fontSize: 12, color: '#c80', margin: '4px 0' },
  error: { fontSize: 12, color: '#c00', margin: '4px 0' },
  configBox: {
    background: '#fafafa',
    border: '1px solid #eee',
    borderRadius: 6,
    padding: 12,
    margin: '8px 0',
  },
  configRow: { display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', flexWrap: 'wrap' },
  configLabel: { fontSize: 12, color: '#666', minWidth: 96, fontFamily: 'ui-monospace, monospace' },
  code: {
    fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    wordBreak: 'break-all',
    flex: 1,
    minWidth: 200,
  },
  kindBadge: {
    fontSize: 11,
    background: '#eee',
    borderRadius: 4,
    padding: '1px 6px',
    color: '#555',
  },
  input: {
    flex: 1,
    minWidth: 180,
    padding: '4px 6px',
    fontSize: 12,
    fontFamily: 'ui-monospace, monospace',
  },
  inputSmall: {
    width: 70,
    padding: '4px 6px',
    fontSize: 12,
    fontFamily: 'ui-monospace, monospace',
  },
  actions: { display: 'flex', gap: 12, margin: '8px 0' },
  button: {
    padding: '8px 16px',
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  },
  smallButton: {
    padding: '4px 10px',
    background: '#444',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  table: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { border: '1px solid #eee', borderRadius: 6, padding: '8px 10px' },
  rowHead: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  runButton: {
    padding: '3px 10px',
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    minWidth: 44,
  },
  testId: { fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, monospace', minWidth: 54 },
  testLabel: { fontSize: 13, flex: 1, minWidth: 160 },
  gate: { fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px' },
  master: {
    fontSize: 10,
    fontWeight: 700,
    background: '#ffe9e9',
    color: '#c00',
    borderRadius: 4,
    padding: '1px 6px',
  },
  nonFatal: {
    fontSize: 10,
    background: '#f0f0f0',
    color: '#888',
    borderRadius: 4,
    padding: '1px 6px',
  },
  status: {
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'ui-monospace, monospace',
    minWidth: 60,
    textAlign: 'right',
  },
  pathNote: { fontSize: 11, color: '#666', margin: '6px 0 2px' },
  assertion: {
    fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    margin: '2px 0',
    paddingLeft: 8,
  },
  assertionLabel: { color: '#333' },
  assertionReason: { color: '#888', marginLeft: 8 },
};
