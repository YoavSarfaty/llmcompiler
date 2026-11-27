import { describe, expect, it } from "vitest";
import { validateCompilePayload, validateReviewPayload } from "../../src/compiler/validateResult.ts";

const validPayload = {
  protocolVersion: 1,
  schemaVersion: 1,
  requestId: "req-1",
  documentVersion: 3,
  status: "success",
  ir: "define i32 @main() {\nentry:\n  ret i32 0\n}",
  mappings: [
    {
      semanticId: "main.ret",
      sourceRanges: [{ from: 0, to: 1 }],
      irRefs: [{ function: "main", anchor: "ret i32 0" }],
      confidence: "high",
    },
  ],
  diagnostics: [],
};

describe("model output validation", () => {
  it("accepts a well-formed success payload", () => {
    const result = validateCompilePayload(validPayload);
    expect(result.value).toBeDefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a well-formed error payload", () => {
    const result = validateCompilePayload({
      protocolVersion: 1,
      schemaVersion: 1,
      requestId: "req-2",
      documentVersion: 1,
      status: "error",
      diagnostics: [{ code: "E001", severity: "error", message: "Not code." }],
    });
    expect(result.value).toBeDefined();
  });

  it("rejects a success without mappings", () => {
    const { mappings: _ignored, ...withoutMappings } = validPayload;
    const result = validateCompilePayload(withoutMappings);
    expect(result.value).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === "E019")).toBe(true);
  });

  it("rejects an unknown diagnostic code", () => {
    const result = validateCompilePayload({
      ...validPayload,
      diagnostics: [{ code: "E999", message: "Mystery." }],
    });
    expect(result.value).toBeUndefined();
  });

  it("rejects an error payload with no error diagnostic", () => {
    const result = validateCompilePayload({
      protocolVersion: 1,
      schemaVersion: 1,
      requestId: "req-3",
      documentVersion: 1,
      status: "error",
      diagnostics: [],
    });
    expect(result.value).toBeUndefined();
  });

  it("rejects an error payload that carries IR", () => {
    const result = validateCompilePayload({
      protocolVersion: 1,
      schemaVersion: 1,
      requestId: "req-4",
      documentVersion: 1,
      status: "error",
      ir: "define i32 @main() {\nentry:\n  ret i32 0\n}",
      diagnostics: [{ code: "E002", message: "Ambiguous." }],
    });
    expect(result.value).toBeUndefined();
  });

  it("rejects duplicate semantic ids", () => {
    const result = validateCompilePayload({
      ...validPayload,
      mappings: [validPayload.mappings[0], validPayload.mappings[0]],
    });
    expect(result.value).toBeUndefined();
  });

  it("accepts a patch-shaped ir", () => {
    const result = validateCompilePayload({
      ...validPayload,
      ir: { kind: "patch", replaceFunctions: [{ name: "main", text: "define i32 @main() {\nentry:\n  ret i32 0\n}" }] },
    });
    expect(result.value).toBeDefined();
  });

  it("validates review payloads", () => {
    const ok = validateReviewPayload({
      protocolVersion: 1,
      schemaVersion: 1,
      requestId: "req-5",
      documentVersion: 1,
      verdict: "pass",
      checks: {
        controlFlow: "pass",
        dataFlow: "pass",
        typesAndConversions: "pass",
        sideEffects: "pass",
        ioBehaviour: "pass",
        termination: "pass",
      },
      findings: [],
    });
    expect(ok.value).toBeDefined();

    const bad = validateReviewPayload({ verdict: "probably" });
    expect(bad.value).toBeUndefined();
  });
});
