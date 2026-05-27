import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAINNET, REGTEST, SIGNET, TESTNET, TESTNET4 } from '../constants/networks';
import { broadcastTx } from './broadcast';

function mockFetchOk(body = 'mock-txid'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => body,
      }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockFetchError(
  status: number,
  statusText: string,
  body: string,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      ({
        ok: false,
        status,
        statusText,
        text: async () => body,
      }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));

/**
 * Build a minimal but valid finalized PSBT so the extractor produces real tx hex.
 * Uses a single dummy P2WPKH input with an inline witnessUtxo and a single output.
 * Uses bitcoinjs-lib 7 types (Uint8Array + bigint).
 */
function buildFinalizedPsbtHex(): string {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({
    hash: '0'.repeat(64),
    index: 0,
    witnessUtxo: {
      script: hexBytes(`0014${'aa'.repeat(20)}`),
      value: BigInt(100000),
    },
    finalScriptWitness: hexBytes(
      // VarInt 0x02, two minimal stack items — placeholder witness, but enough to extract.
      '0200000000',
    ),
  });
  psbt.addOutput({
    script: hexBytes(`0014${'bb'.repeat(20)}`),
    value: BigInt(90000),
  });
  return psbt.toHex();
}

/**
 * Build a fully-signed-but-NOT-finalized P2WPKH PSBT — the shape sighash produces by
 * default (`autoFinalized: false`). Used to verify that `broadcastTx` auto-finalizes
 * transparently, matching what lasereyes did.
 *
 * The key here is a deterministic test secret — explicitly fake, not from any wallet.
 */
function buildSignedUnfinalizedPsbtBase64(): string {
  const privateKey = hexBytes('a'.repeat(64));
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error('test setup: failed to derive public key');

  const pkh = bitcoin.crypto.hash160(publicKey);
  const script = new Uint8Array(22);
  script[0] = 0x00;
  script[1] = 0x14;
  script.set(pkh, 2);

  const signer: bitcoin.Signer = {
    publicKey,
    sign: (hash: Uint8Array): Uint8Array => {
      const sig = ecc.sign(hash, privateKey);
      if (!sig) throw new Error('test setup: ecc.sign returned null');
      return sig;
    },
  };

  const psbt = new bitcoin.Psbt();
  psbt.addInput({
    hash: '0'.repeat(64),
    index: 0,
    witnessUtxo: { script, value: BigInt(100000) },
  });
  psbt.addOutput({
    script: hexBytes(`0014${'bb'.repeat(20)}`),
    value: BigInt(90000),
  });
  psbt.signInput(0, signer);
  // Deliberately do NOT finalize — broadcastTx should handle this transparently.
  return psbt.toBase64();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('broadcastTx — network → URL mapping', () => {
  const rawTxHex = '02000000000101abcdef00';

  it('uses mempool.space mainnet endpoint for mainnet', async () => {
    const fetchMock = mockFetchOk();
    await broadcastTx(rawTxHex, MAINNET);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mempool.space/api/tx');
  });

  it('uses mempool.space testnet endpoint for testnet', async () => {
    const fetchMock = mockFetchOk();
    await broadcastTx(rawTxHex, TESTNET);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mempool.space/testnet/api/tx');
  });

  it('uses mempool.space testnet4 endpoint for testnet4', async () => {
    const fetchMock = mockFetchOk();
    await broadcastTx(rawTxHex, TESTNET4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mempool.space/testnet4/api/tx');
  });

  it('uses mempool.space signet endpoint for signet', async () => {
    const fetchMock = mockFetchOk();
    await broadcastTx(rawTxHex, SIGNET);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mempool.space/signet/api/tx');
  });

  it('throws for regtest (no public endpoint)', async () => {
    const fetchMock = mockFetchOk();
    await expect(broadcastTx(rawTxHex, REGTEST)).rejects.toThrow(
      /No public broadcast endpoint configured for network "regtest"/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('broadcastTx — input format extraction', () => {
  it('passes raw signed-tx hex (version 0x02) through unchanged', async () => {
    const fetchMock = mockFetchOk();
    const rawTxHex = '02000000000101deadbeef';
    await broadcastTx(rawTxHex, MAINNET);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(rawTxHex);
  });

  it('passes raw signed-tx hex (version 0x01) through unchanged', async () => {
    const fetchMock = mockFetchOk();
    const rawTxHex = '01000000000101deadbeef';
    await broadcastTx(rawTxHex, MAINNET);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(rawTxHex);
  });

  it('extracts the raw tx from a finalized PSBT (hex)', async () => {
    const fetchMock = mockFetchOk();
    const psbtHex = buildFinalizedPsbtHex();
    expect(psbtHex.startsWith('70736274ff')).toBe(true);
    await broadcastTx(psbtHex, MAINNET);
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(sentBody).not.toBe(psbtHex);
    // Extracted raw tx must start with the version prefix.
    expect(sentBody).toMatch(/^0[12]000000/);
  });

  it('extracts the raw tx from a finalized PSBT (base64)', async () => {
    const fetchMock = mockFetchOk();
    const psbt = bitcoin.Psbt.fromHex(buildFinalizedPsbtHex());
    const psbtBase64 = psbt.toBase64();
    expect(psbtBase64.startsWith('cHNidP8')).toBe(true);
    await broadcastTx(psbtBase64, MAINNET);
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(sentBody).toMatch(/^0[12]000000/);
  });

  it('auto-finalizes a signed-but-not-finalized PSBT before extracting (the splitting-tool case)', async () => {
    const fetchMock = mockFetchOk();
    const psbtBase64 = buildSignedUnfinalizedPsbtBase64();
    // Sanity check: re-parse and confirm the input isn't finalized yet.
    const beforePsbt = bitcoin.Psbt.fromBase64(psbtBase64);
    expect(beforePsbt.data.inputs[0]?.finalScriptWitness).toBeUndefined();
    expect(beforePsbt.data.inputs[0]?.partialSig?.length ?? 0).toBeGreaterThan(0);

    await broadcastTx(psbtBase64, MAINNET);

    // broadcastTx should still have produced raw tx hex (i.e. it auto-finalized).
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(sentBody).toMatch(/^0[12]000000/);
  });

  it('throws a useful error when the input is not a recognizable tx or PSBT', async () => {
    mockFetchOk();
    await expect(broadcastTx('hello world', MAINNET)).rejects.toThrow(
      /not a recognizable raw signed-tx hex or PSBT/,
    );
  });
});

describe('broadcastTx — request shape and error surfacing', () => {
  it('POSTs the raw tx hex as text/plain', async () => {
    const fetchMock = mockFetchOk();
    await broadcastTx('02000000000101abcdef00', MAINNET);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
  });

  it('returns the trimmed response body as the txid', async () => {
    mockFetchOk('  abcdef123\n');
    const txid = await broadcastTx('02000000000101abcdef00', MAINNET);
    expect(txid).toBe('abcdef123');
  });

  it('surfaces non-2xx body + status in the error message', async () => {
    mockFetchError(400, 'Bad Request', 'min relay fee not met');
    await expect(broadcastTx('02000000000101abcdef00', MAINNET)).rejects.toThrow(
      /Broadcast to https:\/\/mempool\.space\/api failed \(400 Bad Request\): min relay fee not met/,
    );
  });

  it('falls back to "(no body)" when the error response is empty', async () => {
    mockFetchError(503, 'Service Unavailable', '');
    await expect(broadcastTx('02000000000101abcdef00', MAINNET)).rejects.toThrow(
      /\(503 Service Unavailable\): \(no body\)/,
    );
  });
});
