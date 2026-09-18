// How a personal store's codec is tied to the contract it persists, and how
// that contract is allowed to grow.
//
// A schema shape is written as an object literal against its domain type, so a
// field the contract does not declare, one it declares and the schema drops,
// and one whose stored type disagrees are all compile errors rather than a
// document that quietly stops matching the interface it claims to be.
//
// Growth is versionless: the same file is written by whichever fx an agent
// host launched and read by whichever fx the person runs next. A field a newer
// fx added is not corruption, so reads ignore what they do not know instead of
// failing the workspace closed. Writes stay strict, which is what refuses a
// value outside the contract rather than persisting it, so an ignored field is
// also dropped by the next write: an older fx degrades the document it does not
// understand, but never rejects it.

import type * as z from 'zod';

export type ShapeOf<T> = { readonly [K in keyof T]-?: z.ZodType<T[K]> };
