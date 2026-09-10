// The current time as a port, so anything with a window — a cache entry, an
// acknowledged setup step — can be tested without waiting it out.

export interface Clock {
  now(): Date;
}
