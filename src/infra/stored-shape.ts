// Require each persisted domain field to have a matching schema.

import type * as z from 'zod';

export type ShapeOf<T> = { readonly [K in keyof T]-?: z.ZodType<T[K]> };
