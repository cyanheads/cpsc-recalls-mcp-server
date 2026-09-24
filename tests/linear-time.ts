/**
 * @fileoverview Timing helper for tests that pin a text pass to linear time: measures one
 * call at 5,000 and at 80,000 characters.
 * @module tests/linear-time
 */

/** Characters processed per trial, so both sizes are timed over the same total work. */
const WORK_PER_TRIAL = 320_000;
const TRIALS = 5;

/** Fastest per-call time, in milliseconds, of `run(input)` over {@link TRIALS} trials. */
function perCallMs(run: (input: string) => unknown, input: string): number {
  const calls = Math.ceil(WORK_PER_TRIAL / input.length);
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial++) {
    const start = performance.now();
    for (let call = 0; call < calls; call++) run(input);
    best = Math.min(best, (performance.now() - start) / calls);
  }
  return best;
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
  const ms5k = perCallMs(run, make(5_000));
  const ms80k = perCallMs(run, make(80_000));
  return { ms80k, ratio: ms80k / ms5k };
}
