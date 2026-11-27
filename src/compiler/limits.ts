/**
 * Published ceilings from decisions.md D-12 and
 * docs/compiler-specification.md §2.4, §6.4 and §8.2.
 *
 * These are contract values, not tuning knobs. Changing one is a
 * specification change.
 */
export const LIMITS = {
  maxSourceBytes: 32 * 1024,
  maxSourceLines: 4096,
  maxIrBytes: 256 * 1024,
  maxOutputTokens: 4096,
  generationTimeoutMs: 180_000,
  reviewTimeoutMs: 120_000,
  compileTimeoutMs: 60_000,
  executionTimeoutMs: 5_000,
  executionMemoryBytes: 256 * 1024 * 1024,
  maxCapturedOutputBytes: 1024 * 1024,
  debounceMs: 500,
} as const;
