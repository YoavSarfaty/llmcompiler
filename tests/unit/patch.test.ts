import { describe, expect, it } from "vitest";
import { applyIrPatch } from "../../src/compiler/patch.ts";
import { parseIrModule } from "../../src/compiler/irSpans.ts";
import { fixture } from "../helpers.ts";

const FIB = fixture("ir", "fib.ll");

describe("incremental patch application", () => {
  it("replaces one function and preserves everything else byte-for-byte", () => {
    const replacement = `define i64 @fib(i64 %x) {
entry:
  %is0 = icmp eq i64 %x, 0
  %is1 = icmp eq i64 %x, 1
  %base = or i1 %is0, %is1
  br i1 %base, label %ret.one, label %recurse

ret.one:
  ret i64 1

recurse:
  %a = sub i64 %x, 1
  %fa = call i64 @fib(i64 %a)
  %b = sub i64 %x, 3
  %fb = call i64 @fib(i64 %b)
  %sum = add i64 %fa, %fb
  ret i64 %sum
}`;

    const outcome = applyIrPatch(FIB, {
      kind: "patch",
      replaceFunctions: [{ name: "fib", text: replacement }],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ir).toContain("%b = sub i64 %x, 3");
    expect(outcome.ir).not.toContain("%b = sub i64 %x, 2");

    const before = parseIrModule(FIB);
    const after = parseIrModule(outcome.ir);
    expect(after.functions.map((fn) => fn.name)).toEqual(before.functions.map((fn) => fn.name));
    // The untouched main body is identical.
    const mainBefore = before.functions.find((fn) => fn.name === "main")!.text;
    const mainAfter = after.functions.find((fn) => fn.name === "main")!.text;
    expect(mainAfter).toBe(mainBefore);
  });

  it("adds a global before the first function", () => {
    const outcome = applyIrPatch(FIB, {
      kind: "patch",
      addGlobals: ['@.extra = private unnamed_addr constant [2 x i8] c"x\\00", align 1'],
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.ir).toContain('@.extra = private unnamed_addr constant [2 x i8] c"x\\00", align 1');
    expect(outcome.ir.indexOf("@.extra")).toBeLessThan(outcome.ir.indexOf("define i64 @fib"));
  });

  it("removes an unused global", () => {
    const ir = `@.unused = private unnamed_addr constant [2 x i8] c"x\\00", align 1\n\n${FIB}`;
    const outcome = applyIrPatch(ir, { kind: "patch", removeGlobals: [".unused"] });
    expect(outcome.ok).toBe(true);
    expect(outcome.ir).not.toContain("@.unused");
  });

  it("discards a patch that removes a global the module still references", () => {
    const outcome = applyIrPatch(FIB, { kind: "patch", removeGlobals: [".outfmt"] });
    expect(outcome.ok).toBe(false);
    expect(outcome.ir).toBe(FIB);
    expect(outcome.diagnostics.some((d) => d.code === "W008")).toBe(true);
  });

  it("discards a patch that references an unknown function", () => {
    const outcome = applyIrPatch(FIB, {
      kind: "patch",
      replaceFunctions: [{ name: "nope", text: "define void @nope() {\nentry:\n  ret void\n}" }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ir).toBe(FIB);
    expect(outcome.diagnostics.some((d) => d.code === "W008")).toBe(true);
  });

  it("discards a patch whose result fails conformance", () => {
    const outcome = applyIrPatch(FIB, {
      kind: "patch",
      replaceFunctions: [{ name: "fib", text: "define i64 @fib(i64* %x) {\nentry:\n  ret i64 0\n}" }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics.some((d) => d.code === "W008")).toBe(true);
  });

  it("discards a patch that removes main", () => {
    const outcome = applyIrPatch(FIB, {
      kind: "patch",
      replaceFunctions: [{ name: "main", text: "define i32 @other() {\nentry:\n  ret i32 0\n}" }],
    });
    expect(outcome.ok).toBe(false);
  });

  it("validates a full update", () => {
    const outcome = applyIrPatch(FIB, { kind: "full", ir: fixture("ir", "hello.ll") });
    expect(outcome.ok).toBe(true);
    expect(outcome.ir).toContain("hello, world");
  });
});
