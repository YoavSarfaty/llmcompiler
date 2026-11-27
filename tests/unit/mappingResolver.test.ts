import { describe, expect, it } from "vitest";
import { parseIrModule } from "../../src/compiler/irSpans.ts";
import { resolveMappings } from "../../src/compiler/mappingResolver.ts";
import { FIB_SOURCE, rangeOf } from "../../src/model/fibFixture.ts";
import { fixture } from "../helpers.ts";

describe("mapping resolution", () => {
  it("resolves the reference mappings to instruction identities", () => {
    const module = parseIrModule(fixture("ir", "fib.ll"));
    const source = fixture("source", "fib.txt");
    expect(source).toBe(FIB_SOURCE);

    const result = resolveMappings(module, source, [
      {
        semanticId: "base",
        sourceRanges: [rangeOf(source, "If x is 0 or 1 return 1")],
        irRefs: [{ function: "fib", anchor: "ret i64 1" }],
      },
      {
        semanticId: "recurse",
        sourceRanges: [rangeOf(source, "Else return fib of x-1 plus fib of x-2")],
        irRefs: [
          { function: "fib", anchor: "%a = sub i64 %x, 1" },
          { function: "fib", anchor: "%fa = call i64 @fib(i64 %a)" },
        ],
      },
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[0]!.instructionIds).toEqual(["fn:fib#4"]);
    expect(result.mappings[1]!.instructionIds).toEqual(["fn:fib#5", "fn:fib#6"]);
  });

  it("consumes duplicate anchors in module order within one mapping", () => {
    const module = parseIrModule(`define i32 @main() {
entry:
  store i32 0, ptr null, align 4
  store i32 0, ptr null, align 4
  ret i32 0
}
`);
    const source = "x";
    const result = resolveMappings(module, source, [
      {
        semanticId: "both-stores",
        sourceRanges: [{ from: 0, to: 1 }],
        irRefs: [
          { function: "main", anchor: "store i32 0, ptr null, align 4" },
          { function: "main", anchor: "store i32 0, ptr null, align 4" },
        ],
      },
    ]);
    expect(result.mappings[0]!.instructionIds).toEqual(["fn:main#0", "fn:main#1"]);
  });

  it("allows different mappings to reference the same instruction", () => {
    const module = parseIrModule(`define i32 @main() {
entry:
  ret i32 0
}
`);
    const result = resolveMappings(module, "ab", [
      {
        semanticId: "first",
        sourceRanges: [{ from: 0, to: 1 }],
        irRefs: [{ function: "main", anchor: "ret i32 0" }],
      },
      {
        semanticId: "second",
        sourceRanges: [{ from: 1, to: 2 }],
        irRefs: [{ function: "main", anchor: "ret i32 0" }],
      },
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.mappings.map((mapping) => mapping.instructionIds)).toEqual([
      ["fn:main#0"],
      ["fn:main#0"],
    ]);
  });

  it("drops an unresolvable anchor with W001 instead of guessing", () => {
    const module = parseIrModule(fixture("ir", "fib.ll"));
    const result = resolveMappings(module, FIB_SOURCE, [
      {
        semanticId: "missing",
        sourceRanges: [rangeOf(FIB_SOURCE, "Take user input number")],
        irRefs: [{ function: "fib", anchor: "%nope = add i64 0, 0" }],
      },
    ]);
    // Only the irRef is dropped; the mapping survives with its source range.
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]!.instructionIds).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === "W001")).toBe(true);
  });

  it("drops a range that splits a surrogate pair", () => {
    const module = parseIrModule(fixture("ir", "fib.ll"));
    const source = `a😀b`;
    const result = resolveMappings(module, source, [
      { semanticId: "bad", sourceRanges: [{ from: 1, to: 2 }], irRefs: [] },
    ]);
    expect(result.diagnostics.some((d) => d.code === "W001")).toBe(true);
    expect(result.mappings).toHaveLength(0);
  });
});
