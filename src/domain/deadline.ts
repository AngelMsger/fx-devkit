// Work given a deadline: past it, the fallback wins and the work is told to
// stop through the signal it was handed. The timer is kept referenced so the
// fallback is delivered even when nothing else keeps the process alive.

export function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  const control = new AbortController();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      control.abort();
      resolve(fallback);
    }, ms);
    Promise.resolve()
      .then(() => work(control.signal))
      .then(resolve, () => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}
