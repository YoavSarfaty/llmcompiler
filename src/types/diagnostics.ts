/**
 * Diagnostic vocabulary shared by every stage of the pipeline.
 *
 * Codes are stable identifiers, not UI strings. The authoritative table
 * lives in docs/compiler-specification.md §7; this module mirrors it so
 * that code and documentation cannot drift silently.
 */

export type Severity = "error" | "warning" | "info";

export type Stage =
  | "intake"
  | "generation"
  | "normalize"
  | "conformance"
  | "parse"
  | "verify"
  | "optimize"
  | "codegen"
  | "link"
  | "review"
  | "execute";

/** Half-open UTF-16 code-unit interval into the exact source string. */
export interface SourceRange {
  from: number;
  to: number;
}

export interface IrRange {
  line: number;
  column: number;
  length?: number;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  details?: string;
  sourceRanges?: SourceRange[];
  irRanges?: IrRange[];
  stage: Stage;
}

export interface CodeInfo {
  severity: Severity;
  category: string;
  title: string;
}

export const CODES: Record<string, CodeInfo> = {
  E001: { severity: "error", category: "source", title: "Input is a request rather than code" },
  E002: { severity: "error", category: "semantic", title: "Ambiguous operation" },
  E003: { severity: "error", category: "semantic", title: "Missing required information" },
  E004: { severity: "error", category: "semantic", title: "Contradictory semantics" },
  E005: { severity: "error", category: "unsupported", title: "Unsupported construct" },
  E006: { severity: "error", category: "review", title: "Semantic review failed" },
  E007: { severity: "error", category: "ir", title: "LLVM IR parsing or verification failed" },
  E008: { severity: "error", category: "codegen", title: "Code generation failed" },
  E009: { severity: "error", category: "link", title: "Linking failed" },
  E010: { severity: "error", category: "runtime", title: "Program execution failed" },
  E011: { severity: "error", category: "environment", title: "Insufficient browser or hardware capability" },
  E012: { severity: "error", category: "internal", title: "Model or compiler internal failure" },
  E013: { severity: "error", category: "incremental", title: "Incremental patch rejected (reserved)" },
  E014: { severity: "error", category: "limits", title: "Input or output exceeds a documented limit" },
  E015: { severity: "error", category: "timeout", title: "Stage timed out" },
  E016: { severity: "info", category: "cancel", title: "Cancelled before completion" },
  E017: { severity: "error", category: "abi", title: "ABI or runtime contract violation" },
  E018: { severity: "error", category: "subset", title: "IR outside the supported subset" },
  E019: { severity: "error", category: "model", title: "Model output did not conform to the schema" },
  E020: { severity: "error", category: "model", title: "Model unavailable" },
  W001: { severity: "warning", category: "mapping", title: "Mapping anchor did not resolve" },
  W002: { severity: "warning", category: "normalize", title: "Model-supplied target or declaration replaced" },
  W003: { severity: "warning", category: "review", title: "Semantic review inconclusive" },
  W004: { severity: "warning", category: "incremental", title: "Reduced compilation region" },
  W005: { severity: "warning", category: "source", title: "Leading byte-order mark present" },
  W006: { severity: "warning", category: "normalize", title: "Model output normalized" },
  W007: { severity: "warning", category: "model", title: "Bounded repair attempt made" },
  W008: { severity: "warning", category: "incremental", title: "Incremental patch discarded; full compilation issued" },
  W009: { severity: "warning", category: "runtime", title: "Captured output truncated" },
  W010: { severity: "warning", category: "stale", title: "Compilation is stale relative to the source" },
};

export interface DiagnosticInit {
  message: string;
  details?: string;
  sourceRanges?: SourceRange[];
  irRanges?: IrRange[];
  stage: Stage;
}

export function diagnostic(code: string, init: DiagnosticInit): Diagnostic {
  const info = CODES[code];
  if (!info) {
    throw new Error(`Unknown diagnostic code: ${code}`);
  }
  return {
    code,
    severity: info.severity,
    message: init.message,
    details: init.details,
    sourceRanges: init.sourceRanges,
    irRanges: init.irRanges,
    stage: init.stage,
  };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
