declare const __PKG_VERSION__: string;
/** Resolved from package.json at build time so the constant can't drift from npm. */
export const SIGHASH_CORE_VERSION: string =
  typeof __PKG_VERSION__ === 'undefined' ? '0.0.0-dev' : __PKG_VERSION__;

export * from './client';
export * from './constants';
export { broadcastTx } from './lib/broadcast';
export {
  base64ToBytes,
  base64ToHex,
  bytesToBase64,
  bytesToHex,
  hexToBase64,
  hexToBytes,
  isBase64,
  isHex,
  resolvePsbtFormats,
} from './lib/encoding';
export {
  deriveInputsToSign,
  getBitcoinJsNetwork,
  inputsToSignRecord,
  toXverseInputsToSign,
  type XverseInputToSign,
} from './lib/psbt';
export * from './providers';
export { createInitialStore, createStores, type Stores } from './store';
export * from './types';
