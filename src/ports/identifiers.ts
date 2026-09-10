// Opaque operation identifiers keep branch allocation independent of time and
// make allocation deterministic in decision tests.

export interface Identifiers {
  next(): string;
}
