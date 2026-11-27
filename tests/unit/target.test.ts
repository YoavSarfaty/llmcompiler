import { describe, expect, it } from "vitest";
import { checkAbi } from "../../src/compiler/abiChecker.ts";
import { parseIrModule } from "../../src/compiler/irSpans.ts";
import { normalizeRuntimeDeclarations } from "../../src/compiler/target.ts";

describe("ABI target normalization", () => {
  it("rejects and normalizes a mismatched WASI stream global", () => {
    const ir = `@stdin = global ptr null\n\ndefine i32 @main() {\nentry:\n  ret i32 0\n}\n`;
    const originalDiagnostics = checkAbi(parseIrModule(ir));
    expect(originalDiagnostics.some((item) => item.code === "E017" && item.message.includes("@stdin"))).toBe(true);

    const normalized = normalizeRuntimeDeclarations(ir);
    expect(normalized.ir).toContain("@stdin = external global ptr");
    expect(normalized.diagnostics.map((item) => item.code)).toEqual(["W002"]);
    expect(checkAbi(parseIrModule(normalized.ir))).toEqual([]);
  });

  it("leaves canonical stream globals unchanged", () => {
    const ir = `@stdin = external global ptr\n\ndefine i32 @main() {\nentry:\n  ret i32 0\n}\n`;
    const normalized = normalizeRuntimeDeclarations(ir);
    expect(normalized.ir).toBe(ir);
    expect(normalized.diagnostics).toEqual([]);
  });
});
