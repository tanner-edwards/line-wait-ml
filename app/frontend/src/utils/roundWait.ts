export function roundWait(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

export function roundWaitNullable(n: number | null): number | null {
  return n == null ? null : roundWait(n);
}
