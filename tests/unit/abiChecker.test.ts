import { describe, expect, it } from "vitest";
import { parseIrModule } from "../../src/compiler/irSpans.ts";
import { checkAbi, normalizeParam, splitParams } from "../../src/compiler/abiChecker.ts";
import { fixture } from "../helpers.ts";

function abiOf(text: string) {
  return checkAbi(parseIrModule(text));
}

describe("ABI checker", () => {
  it("accepts the reference modules", () => {
    expect(abiOf(fixture("ir", "fib.ll"))).toEqual([]);
    expect(abiOf(fixture("ir", "malloc-strcpy.ll"))).toEqual([]);
  });

  it("rejects a size_t that is 64-bit", () => {
    const diagnostics = abiOf(fixture("ir", "bad-declaration.ll"));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("E017");
    expect(diagnostics[0]!.message).toContain("strlen");
    expect(diagnostics[0]!.details).toContain("i32 @strlen(ptr)");
  });

  it("rejects a printf whose format argument is not a pointer", () => {
    const diagnostics = abiOf(`declare i32 @printf(i64, ...)

define i32 @main() {
entry:
  ret i32 0
}
`);
    expect(diagnostics.some((d) => d.message.includes("printf"))).toBe(true);
  });

  it("rejects defining a symbol the sysroot provides", () => {
    const diagnostics = abiOf(`define ptr @malloc(i32 %n) {
entry:
  ret ptr null
}

define i32 @main() {
entry:
  ret i32 0
}
`);
    expect(diagnostics.some((d) => d.message.includes("defines `@malloc`"))).toBe(true);
  });

  it("rejects a call with no declaration", () => {
    const diagnostics = abiOf(`define i32 @main() {
entry:
  %r = call i32 (ptr, ...) @printf(ptr null)
  ret i32 0
}
`);
    expect(diagnostics.some((d) => d.message.includes("without a declaration"))).toBe(true);
  });

  it("rejects a main with the wrong signature", () => {
    const diagnostics = abiOf(`define void @main() {
entry:
  ret void
}
`);
    expect(diagnostics.some((d) => d.message.includes("`main` must be"))).toBe(true);
  });

  it("normalizes parameter attributes and names", () => {
    expect(normalizeParam("ptr noundef %s")).toBe("ptr");
    expect(normalizeParam("i32 noundef")).toBe("i32");
    expect(normalizeParam("double")).toBe("double");
    expect(normalizeParam("...")).toBe("...");
  });

  it("splits parameters without breaking nested types", () => {
    expect(splitParams("ptr, i32, ...")).toEqual(["ptr", "i32", "..."]);
    expect(splitParams("[4 x i8], i32")).toEqual(["[4 x i8]", "i32"]);
  });
});
