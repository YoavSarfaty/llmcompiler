import { describe, expect, it } from "vitest";
import { runCompilation } from "../../src/compiler/coordinator.ts";
import { StageTimeoutError, withStageTimeout } from "../../src/compiler/timeout.ts";
import { MockLlmClient } from "../../src/model/MockLlmClient.ts";
import { FIB_SOURCE } from "../../src/model/fibFixture.ts";
import type { CompileOutcome, LlmClient, ReviewPayload } from "../../src/types/protocol.ts";

const mock = new MockLlmClient();

describe("stage timeouts", () => {
  it("rejects an operation with its stage and deadline", async () => {
    await expect(withStageTimeout(new Promise<never>(() => {}), 5, "generation")).rejects.toMatchObject({
      stage: "generation",
      timeoutMs: 5,
    });
    expect(() => new StageTimeoutError("review", 10)).not.toThrow();
  });

  it("returns E015 when generation exceeds its deadline", async () => {
    const client: LlmClient = {
      capabilities: () => mock.capabilities(),
      compile: () => new Promise<CompileOutcome>(() => {}),
      review: (request) => mock.review(request),
    };
    const result = await runCompilation({
      source: FIB_SOURCE,
      documentVersion: 1,
      requestId: "timeout-generation",
      client,
      timeouts: { generationMs: 5 },
    });

    expect(result.succeeded).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "E015" && item.stage === "generation")).toBe(true);
  });

  it("keeps compilation successful when review times out and reports W003", async () => {
    const client: LlmClient = {
      capabilities: () => mock.capabilities(),
      compile: (request) => mock.compile(request),
      review: () => new Promise<ReviewPayload>(() => {}),
    };
    const result = await runCompilation({
      source: FIB_SOURCE,
      documentVersion: 1,
      requestId: "timeout-review",
      client,
      timeouts: { reviewMs: 5 },
    });

    expect(result.succeeded).toBe(true);
    expect(result.review?.verdict).toBe("inconclusive");
    expect(result.diagnostics.some((item) => item.code === "W003" && item.stage === "review")).toBe(true);
  });
});
