import type { Stage } from "../types/diagnostics.ts";

export class StageTimeoutError extends Error {
  constructor(
    readonly stage: Stage,
    readonly timeoutMs: number,
  ) {
    super(`The ${stage} stage exceeded its ${timeoutMs} ms timeout.`);
    this.name = "StageTimeoutError";
  }
}

/** Race a stage against its published deadline without changing the stage promise. */
export async function withStageTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  stage: Stage,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StageTimeoutError(stage, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
