import { describe, expect, it } from "vitest";
import { normalizeModelText, parseCompileResponse, parseReviewResponse } from "../../src/model/responseParser.ts";

const validCompile = JSON.stringify({
  protocolVersion: 1,
  schemaVersion: 1,
  requestId: "parse-test",
  documentVersion: 1,
  status: "success",
  ir: "define i32 @main() {\nentry:\n  ret i32 0\n}",
  mappings: [],
  diagnostics: [],
});

describe("model response normalization", () => {
  it("strips a leading BOM and reports W005", () => {
    const result = normalizeModelText(`\uFEFF${validCompile}`);
    expect(result.text).toBe(validCompile);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["W005"]);
  });

  it("strips one JSON fence and trailing prose with W006", () => {
    const raw = `\uFEFF\`\`\`json\n${validCompile}\n\`\`\` trailing prose`;
    const result = parseCompileResponse(raw);
    expect(result.value).toBeDefined();
    expect(result.diagnostics.map((item) => item.code)).toEqual(["W005", "W006", "W006"]);
  });

  it("returns E019 for invalid JSON and schema-invalid objects", () => {
    expect(parseCompileResponse("not JSON").diagnostics.some((item) => item.code === "E019")).toBe(true);
    expect(parseCompileResponse("{}").diagnostics.some((item) => item.code === "E019")).toBe(true);
  });

  it("parses review responses through the review schema validator", () => {
    const result = parseReviewResponse(
      JSON.stringify({
        protocolVersion: 1,
        schemaVersion: 1,
        requestId: "review-test",
        documentVersion: 1,
        verdict: "inconclusive",
        checks: {
          controlFlow: "unknown",
          dataFlow: "unknown",
          typesAndConversions: "unknown",
          sideEffects: "unknown",
          ioBehaviour: "unknown",
          termination: "unknown",
        },
        findings: [],
      }),
    );
    expect(result.value?.verdict).toBe("inconclusive");
    expect(result.diagnostics).toEqual([]);
  });
});
