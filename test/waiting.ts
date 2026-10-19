// Waiting on what another process does: the check repeats until it holds or the limit
// passes, so a case takes as long as the effect does and the assertion after it reports
// a miss.

export async function until(condition: () => boolean, limitMs = 2000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (!condition() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
