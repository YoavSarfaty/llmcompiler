import { describe, expect, it } from "vitest";
import { runCompilation } from "../../src/compiler/coordinator.ts";
import { MockLlmClient } from "../../src/model/MockLlmClient.ts";
import { FIB_SOURCE } from "../../src/model/fibFixture.ts";
import { LIMITS } from "../../src/compiler/limits.ts";
import { TARGET } from "../../src/compiler/target.ts";

const client = new MockLlmClient();

describe("compilation pipeline", () => {
  it("compiles the reference program end to end without LLVM", async () => {
    const out = await runCompilation({ source: FIB_SOURCE, documentVersion: 1, requestId: "req-1", client });

    expect(out.succeeded).toBe(true);
    expect(out.ir).toContain(`target triple = "${TARGET.triple}"`);
    expect(out.ir).toContain("define i64 @fib(i64 %x)");
    expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(out.mappings).toHaveLength(5);
    expect(out.instructions.length).toBe(18);
    expect(out.review?.verdict).toBe("pass");
  });

  it("reports E001 for a prompt and produces no IR", async () => {
    const out = await runCompilation({
      source: "Make me a Fibonacci program.",
      documentVersion: 1,
      requestId: "req-2",
      client,
    });
    expect(out.succeeded).toBe(false);
    expect(out.ir).toBeNull();
    expect(out.diagnostics.some((d) => d.code === "E001")).toBe(true);
  });

  it("rejects an oversized source before generation", async () => {
    const out = await runCompilation({
      source: "x".repeat(LIMITS.maxSourceBytes + 10),
      documentVersion: 1,
      requestId: "req-3",
      client,
    });
    expect(out.succeeded).toBe(false);
    expect(out.diagnostics.some((d) => d.code === "E014")).toBe(true);
  });

  it("replaces a model-supplied target with the pinned one and warns", async () => {
    const out = await runCompilation({
      source: FIB_SOURCE,
      documentVersion: 1,
      requestId: "req-4",
      client: {
        capabilities: () => client.capabilities(),
        review: (request) => client.review(request),
        compile: async (request) => {
          const outcome = await client.compile(request);
          return {
            ...outcome,
            payload: { ...outcome.payload, ir: `target triple = "x86_64-pc-linux-gnu"\n${outcome.payload.ir}` },
          };
        },
      },
    });
    expect(out.succeeded).toBe(true);
    expect(out.ir).toContain(`target triple = "${TARGET.triple}"`);
    expect(out.ir).not.toContain("x86_64-pc-linux-gnu");
    expect(out.diagnostics.some((d) => d.code === "W002")).toBe(true);
  });

  it("replaces mismatched runtime declarations with the ABI signature", async () => {
    let reviewedIr = "";
    const out = await runCompilation({
      source: FIB_SOURCE,
      documentVersion: 1,
      requestId: "req-declaration-normalization",
      client: {
        capabilities: () => client.capabilities(),
        review: (request) => {
          reviewedIr = request.ir;
          return client.review(request);
        },
        compile: async (request) => {
          const outcome = await client.compile(request);
          return {
            ...outcome,
            payload: {
              ...outcome.payload,
              ir: `${outcome.payload.ir}\ndeclare i64 @strlen(i64)`,
            },
          };
        },
      },
    });

    expect(out.succeeded).toBe(true);
    expect(out.ir).toContain("declare i32 @strlen(ptr)");
    expect(out.ir).not.toContain("declare i64 @strlen(i64)");
    expect(reviewedIr).toContain("declare i32 @strlen(ptr)");
    expect(out.diagnostics.some((item) => item.code === "W002")).toBe(true);
  });

  it("starts semantic review before local conformance and discards it on failure", async () => {
    let reviewStarted = false;
    const out = await runCompilation({
      source: FIB_SOURCE,
      documentVersion: 1,
      requestId: "req-review-overlap",
      client: {
        capabilities: () => client.capabilities(),
        review: (request) => {
          reviewStarted = true;
          return client.review(request);
        },
        compile: async (request) => {
          const outcome = await client.compile(request);
          return {
            ...outcome,
            payload: {
              ...outcome.payload,
              ir: `define i32 @main() {\nentry:\n  %p = alloca i32*\n  ret i32 0\n}`,
            },
          };
        },
      },
    });

    expect(reviewStarted).toBe(true);
    expect(out.succeeded).toBe(false);
    expect(out.ir).toBeNull();
    expect(out.review).toBeNull();
  });

  it("treats a malformed review response as inconclusive", async () => {
    const out = await runCompilation({
      source: FIB_SOURCE,
      documentVersion: 1,
      requestId: "req-malformed-review",
      client: {
        capabilities: () => client.capabilities(),
        compile: (request) => client.compile(request),
        review: async () => ({ verdict: "pass" }) as never,
      },
    });

    expect(out.succeeded).toBe(true);
    expect(out.review?.verdict).toBe("inconclusive");
    expect(out.diagnostics.some((item) => item.code === "W003" && item.stage === "review")).toBe(true);
  });
});
