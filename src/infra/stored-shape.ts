// Ties a personal store's schema to the domain type it persists: a field the
// contract does not declare, one it declares and the schema drops, and one whose
// stored type disagrees are compile errors. See "Personal stores" in
// docs/design/runtime.md for how such a document is allowed to grow.

import type * as z from 'zod';

export type ShapeOf<T> = { readonly [K in keyof T]-?: z.ZodType<T[K]> };
