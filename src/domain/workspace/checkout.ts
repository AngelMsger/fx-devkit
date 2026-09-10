// Shared checkout paths are forward-slash children of the workspace root.
// Normalized keys let both manifest layers compare aliases and nesting;
// native resolution handles absolute personal references.

import path from 'node:path/posix';

export function checkoutPathKey(checkout: string): string {
  return path.normalize(checkout);
}

export function isWorkspaceCheckoutPath(checkout: string): boolean {
  const key = checkoutPathKey(checkout);
  return (
    key !== '.' &&
    key !== '..' &&
    !key.startsWith('../') &&
    !path.isAbsolute(key) &&
    !checkout.includes('\\') &&
    !/^[/\\]{2}/.test(checkout) &&
    !/^[a-z]:/i.test(checkout)
  );
}

export function checkoutPathsOverlap(left: string, right: string): boolean {
  const a = checkoutPathKey(left);
  const b = checkoutPathKey(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
