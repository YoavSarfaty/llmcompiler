import type { Diagnostic } from "../types/diagnostics.ts";
import { VERSIONS } from "../types/protocol.ts";
import type { ReviewPayload } from "../types/protocol.ts";

export interface DiagnosticBundleInput {
  diagnostics: readonly Diagnostic[];
  timings: Readonly<Record<string, number>>;
  review: Pick<ReviewPayload, "verdict"> | null;
}

/**
 * Build a shareable diagnostic summary without accepting source or IR as input.
 * Raw details and source ranges are omitted because tool output can echo code.
 */
export function createDiagnosticBundle(input: DiagnosticBundleInput): string {
  return JSON.stringify(
    {
      appVersion: "0.1.0",
      versions: {
        protocol: VERSIONS.protocol,
        schema: VERSIONS.schema,
        abi: VERSIONS.abi,
        irSubset: VERSIONS.irSubset,
        prompt: VERSIONS.prompt,
        reviewPrompt: VERSIONS.reviewPrompt,
      },
      diagnostics: input.diagnostics.map(({ code, severity, stage, message }) => ({
        code,
        severity,
        stage,
        message,
      })),
      timings: input.timings,
      reviewVerdict: input.review?.verdict ?? "not-run",
    },
    null,
    2,
  );
}
