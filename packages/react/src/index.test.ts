import { describe, expect, it } from 'vitest';
import * as exports from './index';

describe('@sighash/react exports', () => {
  it('exports SighashProvider', () => {
    expect(typeof exports.SighashProvider).toBe('function');
  });

  it('exports useSighash', () => {
    expect(typeof exports.useSighash).toBe('function');
  });

  it('exports SighashContext', () => {
    expect(exports.SighashContext).toBeDefined();
  });

  it('re-exports @sighash/core constants', () => {
    expect(exports.UNISAT).toBe('unisat');
    expect(exports.XVERSE).toBe('xverse');
    expect(exports.OKX).toBe('okx');
    expect(exports.MAINNET).toBe('mainnet');
  });

  it('re-exports @sighash/core SighashClient', () => {
    expect(typeof exports.SighashClient).toBe('function');
  });

  it('exposes the LaserEyes compatibility aliases', () => {
    expect(exports.LaserEyesProvider).toBe(exports.SighashProvider);
    expect(exports.useLaserEyes).toBe(exports.useSighash);
  });

  it('exposes a version string', () => {
    expect(exports.SIGHASH_REACT_VERSION).toBe('0.0.0');
  });
});
