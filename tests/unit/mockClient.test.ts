import { describe, expect, it } from "vitest";
import { MockLlmClient, isReferenceProgram, looksLikeRequest } from "../../src/model/MockLlmClient.ts";
import { FIB_IR, FIB_SOURCE } from "../../src/model/fibFixture.ts";
import type { CompileRequest } from "../../src/types/protocol.ts";

const client = new MockLlmClient();

function request(source: string): CompileRequest {
  return {
    protocolVersion: 1,
    requestId: "req-test",
    documentVersion: 1,
    mode: "full",
    source,
    changedRanges: [],
    previous: null,
    dependencies: { functions: [], globals: [], runtime: [] },
    versions: { promptVersion: 1, reviewPromptVersion: 1, schemaVersion: 1, irSubsetVersion: 1, abiVersion: 1 },
    limits: { maxSourceBytes: 32768, maxOutputTokens: 4096 },
  };
}

describe("mock model", () => {
  it("recognises the reference program", () => {
    expect(isReferenceProgram(FIB_SOURCE)).toBe(true);
  });

  it("detects program-generation requests", () => {
    expect(looksLikeRequest("Make me a Fibonacci program.")).toBe(true);
    expect(looksLikeRequest("Can you write a compiler for me?")).toBe(true);
    expect(looksLikeRequest("")).toBe(true);
    expect(looksLikeRequest(FIB_SOURCE)).toBe(false);
  });

  it("compiles the reference program to the reference IR", async () => {
    const outcome = await client.compile(request(FIB_SOURCE));
    expect(outcome.payload.status).toBe("success");
    expect(outcome.payload.ir).toContain("define i64 @fib(i64 %x)");
    expect(outcome.payload.mappings).toHaveLength(5);
  });

  it("rejects a request with E001", async () => {
    const outcome = await client.compile(request("Make me a Fibonacci program."));
    expect(outcome.payload.status).toBe("error");
    expect(outcome.payload.diagnostics[0]!.code).toBe("E001");
    expect(outcome.payload.ir).toBeUndefined();
  });

  it("returns E002 rather than inventing IR for an unknown program", async () => {
    const outcome = await client.compile(request("x = 1\nprint(x)"));
    expect(outcome.payload.status).toBe("error");
    expect(outcome.payload.diagnostics[0]!.code).toBe("E002");
  });

  it("reviews the reference IR as passing and anything else as inconclusive", async () => {
    const good = await client.review({
      protocolVersion: 1,
      requestId: "r",
      documentVersion: 1,
      source: FIB_SOURCE,
      ir: FIB_IR,
      notes: [],
    });
    expect(good.verdict).toBe("pass");

    const unknown = await client.review({
      protocolVersion: 1,
      requestId: "r",
      documentVersion: 1,
      source: "something else",
      ir: "define i32 @main() {\nentry:\n  ret i32 0\n}",
      notes: [],
    });
    expect(unknown.verdict).toBe("inconclusive");

    const alteredReference = await client.review({
      protocolVersion: 1,
      requestId: "r-altered",
      documentVersion: 1,
      source: FIB_SOURCE,
      ir: `${FIB_IR}\n; changed module`,
      notes: [],
    });
    expect(alteredReference.verdict).toBe("inconclusive");
  });
});
