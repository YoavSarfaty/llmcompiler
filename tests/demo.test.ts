import { describe, it } from "vitest";
import { runCompilation } from "../src/compiler/coordinator.ts";
import { MockLlmClient } from "../src/model/MockLlmClient.ts";
import { FIB_SOURCE } from "../src/model/fibFixture.ts";

const client = new MockLlmClient();

describe("demo", () => {
  it("compiles the reference Fibonacci program", async () => {
    console.log("\n=== INPUT SOURCE ===");
    console.log(FIB_SOURCE);

    const out = await runCompilation({
      source: FIB_SOURCE,
      documentVersion: 1,
      requestId: "demo-fib",
      client,
    });

    console.log("\n=== GENERATED LLVM IR ===");
    console.log(out.ir);

    console.log("\n=== DIAGNOSTICS ===");
    if (out.diagnostics.length === 0) {
      console.log("(none)");
    } else {
      for (const d of out.diagnostics) {
        console.log(`${d.severity.toUpperCase()} ${d.code}: ${d.message}`);
      }
    }

    console.log("\n=== MAPPINGS ===");
    for (const m of out.mappings) {
      console.log(`${m.semanticId} -> ${m.instructionIds.join(", ")}`);
    }

    console.log("\n=== REVIEW ===");
    console.log(`verdict: ${out.review?.verdict}`);
    console.log(`checks: ${JSON.stringify(out.review?.checks)}`);

    console.log("\n=== SUMMARY ===");
    console.log(`succeeded: ${out.succeeded}`);
    console.log(`instructions: ${out.instructions.length}`);
    console.log(`timings: ${JSON.stringify(out.timings)}`);
  });

  it("rejects a prompt-only request with E001", async () => {
    console.log("\n=== INPUT SOURCE ===");
    console.log("Make me a Fibonacci program.");

    const out = await runCompilation({
      source: "Make me a Fibonacci program.",
      documentVersion: 1,
      requestId: "demo-prompt",
      client,
    });

    console.log("\n=== DIAGNOSTICS ===");
    for (const d of out.diagnostics) {
      console.log(`${d.severity.toUpperCase()} ${d.code}: ${d.message}`);
    }
    console.log(`\nIR produced: ${out.ir === null ? "none" : "unexpected"}`);
    console.log(`succeeded: ${out.succeeded}`);
  });
});
