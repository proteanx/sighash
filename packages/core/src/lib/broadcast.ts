import * as bitcoin from 'bitcoinjs-lib';
import { MAINNET, type NetworkType, SIGNET, TESTNET, TESTNET4 } from '../constants/networks';

/**
 * Public mempool.space endpoints used by the default `WalletProvider.pushPsbt`.
 * `regtest` is intentionally omitted — there's no public regtest endpoint and the
 * caller must broadcast via their own data source.
 */
const MEMPOOL_API_BASE: Partial<Record<NetworkType, string>> = {
  [MAINNET]: 'https://mempool.space/api',
  [TESTNET]: 'https://mempool.space/testnet/api',
  [TESTNET4]: 'https://mempool.space/testnet4/api',
  [SIGNET]: 'https://mempool.space/signet/api',
};

/**
 * Broadcasts a signed transaction or finalized PSBT to mempool.space for the given
 * network. Accepts raw signed-tx hex, a PSBT in hex, or a PSBT in base64; the helper
 * extracts the underlying transaction (PSBTs must already be finalized — call
 * `signPsbt` with `finalize: true` first).
 *
 * Returns the txid on success. Throws a descriptive error on any non-2xx response.
 */
export async function broadcastTx(input: string, network: NetworkType): Promise<string> {
  const baseUrl = MEMPOOL_API_BASE[network];
  if (!baseUrl) {
    throw new Error(
      `No public broadcast endpoint configured for network "${network}". Broadcast via your own data source.`,
    );
  }

  const txHex = extractRawTxHex(input);

  const response = await fetch(`${baseUrl}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Broadcast to ${baseUrl} failed (${response.status} ${response.statusText}): ${body || '(no body)'}`,
    );
  }

  return (await response.text()).trim();
}

/**
 * Accepts: raw signed-tx hex (version 0x01/0x02), PSBT hex (magic `70736274ff`), or
 * PSBT base64 (starts with `cHNidP8`). Returns the raw signed-tx hex ready to post.
 */
function extractRawTxHex(input: string): string {
  // Raw signed tx — version bytes 0x01 or 0x02 in little-endian.
  if (input.startsWith('01000000') || input.startsWith('02000000')) {
    return input;
  }
  // PSBT hex.
  if (input.startsWith('70736274ff')) {
    return extractFromPsbt(bitcoin.Psbt.fromHex(input));
  }
  // PSBT base64.
  if (input.startsWith('cHNidP8')) {
    return extractFromPsbt(bitcoin.Psbt.fromBase64(input));
  }
  throw new Error(
    'broadcastTx: input is not a recognizable raw signed-tx hex or PSBT (hex/base64).',
  );
}

/**
 * Extract the raw signed tx from a PSBT, auto-finalizing if needed. sighash's default
 * is `autoFinalized: false` (so marketplace listings keep their SIGHASH_SINGLE | ACP
 * partial-sign semantics), which means a fully-signed PSBT handed to `pushPsbt` often
 * isn't yet finalized. We finalize transparently here so callers don't have to remember
 * to pass `finalize: true` when they actually intend to broadcast.
 */
function extractFromPsbt(psbt: bitcoin.Psbt): string {
  try {
    return psbt.extractTransaction().toHex();
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (!msg.includes('not finalized')) throw err;
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }
}
