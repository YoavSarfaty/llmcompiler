import { describe, expect, it } from "vitest";
import { createDiagnosticBundle } from "../../src/app/diagnosticBundle.ts";
import { diagnostic } from "../../src/types/diagnostics.ts";

describe("diagnostic bundle", () => {
  it("includes version, code, timing, and review metadata only", () => {
    const bundle = createDiagnosticBundle({
      diagnostics: [
        diagnostic("E007", {
          stage: "verify",
          message: "LLVM verification failed. Source excerpt: private source secret",
          details: "raw output that may contain source text",
          sourceRanges: [{ from: 12, to: 25 }],
        }),
      ],
      timings: { verify: 18, total: 40 },
      review: { verdict: "inconclusive" },
    });
    const parsed = JSON.parse(bundle) as {
      versions: Record<string, number>;
      diagnostics: Array<Record<string, unknown>>;
      timings: Record<string, number>;
      reviewVerdict: string;
    };

    expect(parsed.versions.protocol).toBe(1);
    expect(parsed.diagnostics[0]).toEqual({
      code: "E007",
      severity: "error",
      stage: "verify",
      title: "LLVM IR parsing or verification failed",
    });
    expect(parsed.diagnostics[0]).not.toHaveProperty("details");
    expect(parsed.diagnostics[0]).not.toHaveProperty("sourceRanges");
    expect(bundle).not.toContain("raw output that may contain source text");
    expect(bundle).not.toContain("private source secret");
    expect(parsed.timings).toEqual({ verify: 18, total: 40 });
    expect(parsed.reviewVerdict).toBe("inconclusive");
  });

  it("marks an unavailable review as not run", () => {
    const bundle = createDiagnosticBundle({ diagnostics: [], timings: {}, review: null });
    expect(JSON.parse(bundle).reviewVerdict).toBe("not-run");
  });
});
