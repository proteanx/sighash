export const SIGHASH_REACT_VERSION = '0.0.0';

export * from '@sighash/core';
export type { SighashContextValue } from './context';
export { SighashContext } from './context';
export type { SighashProviderProps } from './provider';
export { SighashProvider } from './provider';
export type { UseSighashValue } from './use-sighash';
export { useSighash } from './use-sighash';

/**
 * Compatibility aliases for ARKAiD's LaserEyes-named imports. Use the canonical names
 * (`SighashProvider`, `useSighash`) in new code; these exist to make the find/replace
 * cutover atomic. They will be deprecated after the cutover ships.
 */
export { SighashProvider as LaserEyesProvider } from './provider';
export { useSighash as useLaserEyes } from './use-sighash';
