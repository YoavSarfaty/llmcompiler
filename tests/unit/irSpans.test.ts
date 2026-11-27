import { describe, expect, it } from "vitest";
import { parseIrModule, functionInstructions } from "../../src/compiler/irSpans.ts";
import { fixture } from "../helpers.ts";

describe("IR structural parser", () => {
  it("finds functions, globals and declarations in the reference module", () => {
    const module = parseIrModule(fixture("ir", "fib.ll"));
    expect(module.structuralErrors).toEqual([]);
    expect(module.functions.map((fn) => fn.name)).toEqual(["fib", "main"]);
    expect(module.globals.map((global) => global.name)).toEqual([".prompt", ".infmt", ".outfmt"]);
    expect(module.declarations.map((declaration) => declaration.symbol)).toEqual(["printf", "scanf"]);
  });

  it("extracts instructions in order, excluding labels and blanks", () => {
    const module = parseIrModule(fixture("ir", "fib.ll"));
    const fib = functionInstructions(module, "fib");
    expect(fib.map((instruction) => instruction.normalized)).toEqual([
      "%is0 = icmp eq i64 %x, 0",
      "%is1 = icmp eq i64 %x, 1",
      "%base = or i1 %is0, %is1",
      "br i1 %base, label %ret.one, label %recurse",
      "ret i64 1",
      "%a = sub i64 %x, 1",
      "%fa = call i64 @fib(i64 %a)",
      "%b = sub i64 %x, 2",
      "%fb = call i64 @fib(i64 %b)",
      "%sum = add i64 %fa, %fb",
      "ret i64 %sum",
    ]);
    expect(fib[0]!.id).toBe("fn:fib#0");
    expect(fib[fib.length - 1]!.id).toBe("fn:fib#10");
  });

  it("is not confused by braces inside string literals", () => {
    const text = `@.s = private unnamed_addr constant [4 x i8] c"}{}\\00", align 1
define i32 @main() {
entry:
  ret i32 0
}
`;
    const module = parseIrModule(text);
    expect(module.structuralErrors).toEqual([]);
    expect(module.functions).toHaveLength(1);
    expect(module.functions[0]!.endLine).toBe(5);
  });

  it("handles multi-line global initializers", () => {
    const text = `@.arr = global [3 x i32] [
  i32 1,
  i32 2,
  i32 3
], align 16

define i32 @main() {
entry:
  ret i32 0
}
`;
    const module = parseIrModule(text);
    expect(module.structuralErrors).toEqual([]);
    expect(module.globals[0]!.startLine).toBe(1);
    expect(module.globals[0]!.endLine).toBe(5);
    expect(module.functions[0]!.startLine).toBe(7);
  });

  it("reports an unterminated function body", () => {
    const module = parseIrModule("define i32 @main() {\nentry:\n  ret i32 0\n");
    expect(module.structuralErrors).toHaveLength(1);
    expect(module.structuralErrors[0]!.message).toContain("Unterminated");
  });
});
