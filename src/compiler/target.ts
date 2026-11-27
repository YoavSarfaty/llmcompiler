import { diagnostic, type Diagnostic } from "../types/diagnostics.ts";

/**
 * The pinned target (spec §3.1). The data layout string is the one the
 * pinned toolchain emits for wasm32; it is regenerated from the
 * toolchain at build time and injected, never taken from model output.
 */
export const TARGET = {
  triple: "wasm32-wasip1",
  dataLayout: "e-m:e-p:32:32-p10:8:8-p20:8:8-i64:64-n32:64-S128-ni:1:10:20",
} as const;

const TARGET_LINE = /^\s*target\s+(?:datalayout|triple)\s*=/;

export interface InjectedIr {
  ir: string;
  diagnostics: Diagnostic[];
}

/** Replace any model-supplied target lines with the canonical pair. */
export function injectTarget(ir: string): InjectedIr {
  const lines = ir.split(/\r?\n/);
  const kept: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (TARGET_LINE.test(line)) {
      replaced = true;
      continue;
    }
    kept.push(line);
  }
  const header = [`target datalayout = "${TARGET.dataLayout}"`, `target triple = "${TARGET.triple}"`];
  const diagnostics = replaced
    ? [
        diagnostic("W002", {
          stage: "normalize",
          message: "Model-supplied target triple or data layout was replaced with the pinned target.",
          details: `Using ${TARGET.triple}.`,
        }),
      ]
    : [];
  return { ir: [...header, ...kept].join("\n"), diagnostics };
}
