/**
 * @fileoverview Thread-CPU measurements for text passes at 5,000 and 80,000 characters.
 * @module tests/linear-time
 */

/** Characters processed per trial, so both sizes are timed over the same total work. */
const WORK_PER_TRIAL = 80_000;
const TRIALS = 5;

/** Per-call thread CPU time in milliseconds, excluding other workers and scheduler delays. */
function perCallMs(run: (input: string) => unknown, input: string): number {
  const calls = Math.ceil(WORK_PER_TRIAL / input.length);
  const start = process.threadCpuUsage();
  for (let call = 0; call < calls; call++) run(input);
  const elapsed = process.threadCpuUsage(start);
  return (elapsed.user + elapsed.system) / 1_000 / calls;
}

/**
 * Times `run` on `make(5_000)` and `make(80_000)`. Linear work gives `ratio` near 16 and
 * quadratic near 256, so callers assert `ratio < 64` — never a single step at the
 * quadratic value — plus an absolute bound on `ms80k`.
 */
export function timeAcrossSizes(
  make: (length: number) => string,
  run: (input: string) => unknown,
): { ms80k: number; ratio: number } {
  const small = make(5_000);
  const large = make(80_000);
  // Warm both sizes before comparing, then alternate order to avoid tiering one side only.
  perCallMs(run, small);
  perCallMs(run, large);
  let ms5k = Number.POSITIVE_INFINITY;
  let ms80k = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial++) {
    const sizes = trial % 2 === 0 ? [small, large] : [large, small];
    for (const input of sizes) {
      const elapsed = perCallMs(run, input);
      if (input === small) ms5k = Math.min(ms5k, elapsed);
      else ms80k = Math.min(ms80k, elapsed);
    }
  }
  return { ms80k, ratio: ms80k / ms5k };
}
