// Distribution identity varies by channel; the project and executable remain fx-devkit/fx.
export const DISTRIBUTIONS = {
  internal: { packageName: '@fx/devkit', access: 'restricted' },
  public: { packageName: '@angelmsger/fx', access: 'public' },
};
export const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
/** @param {unknown} value */
export function distribution(value) {
  if (value !== 'internal' && value !== 'public')
    throw new Error('Choose internal or public distribution.');
  return DISTRIBUTIONS[value];
}
/** @param {string} name */
export function packageChannel(name) {
  if (name === DISTRIBUTIONS.internal.packageName) return 'internal';
  if (name === DISTRIBUTIONS.public.packageName) return 'public';
  throw new Error('Unknown fx distribution package.');
}
