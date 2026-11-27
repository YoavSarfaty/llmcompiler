import { describe, expect, it } from "vitest";
import { parseIrModule } from "../../src/compiler/irSpans.ts";
import { checkSubset } from "../../src/compiler/subsetChecker.ts";
import { fixture } from "../helpers.ts";

function subsetOf(text: string) {
  return checkSubset(parseIrModule(text));
}

describe("subset checker", () => {
  it("accepts the reference modules", () => {
    expect(subsetOf(fixture("ir", "fib.ll"))).toEqual([]);
    expect(subsetOf(fixture("ir", "hello.ll"))).toEqual([]);
    expect(subsetOf(fixture("ir", "malloc-strcpy.ll"))).toEqual([]);
  });

  it("rejects typed pointers with E018", () => {
    const diagnostics = subsetOf(fixture("ir", "typed-pointer.ll"));
    expect(diagnostics.some((d) => d.code === "E018" && d.message.includes("Typed pointer"))).toBe(true);
    expect(diagnostics[0]!.irRanges?.[0]?.line).toBe(3);
  });

  it("rejects a module without main", () => {
    const diagnostics = subsetOf(fixture("ir", "no-main.ll"));
    expect(diagnostics.some((d) => d.code === "E018" && d.message.includes("no `main`"))).toBe(true);
  });

  it("rejects i128 and half", () => {
    const diagnostics = subsetOf(`define i32 @main() {
entry:
  %x = alloca i128, align 16
  %y = alloca half, align 2
  ret i32 0
}
`);
    expect(diagnostics.filter((d) => d.code === "E018")).toHaveLength(2);
  });

  it("rejects inline assembly and exception handling", () => {
    const diagnostics = subsetOf(`define i32 @main() {
entry:
  %r = call i32 asm sideeffect "nop", ""()
  invoke void @f() to label %ok unwind label %bad
ok:
  ret i32 0
bad:
  ret i32 1
}
`);
    const messages = diagnostics.map((d) => d.message).join(" ");
    expect(messages).toContain("inline assembly");
    expect(messages).toContain("invoke");
  });

  it("requires monotonic ordering for atomics", () => {
    const bad = subsetOf(`define i32 @main() {
entry:
  %v = load atomic i32, ptr null seq_cst, align 4
  ret i32 0
}
`);
    expect(bad.some((d) => d.message.includes("monotonic"))).toBe(true);

    const good = subsetOf(`define i32 @main() {
entry:
  %v = load atomic i32, ptr null monotonic, align 4
  ret i32 0
}
`);
    expect(good.filter((d) => d.message.includes("monotonic"))).toHaveLength(0);
  });

  it("rejects definitions of startup symbols", () => {
    const diagnostics = subsetOf(`define void @_start() {
entry:
  ret void
}

define i32 @main() {
entry:
  ret i32 0
}
`);
    expect(diagnostics.some((d) => d.message.includes("_start"))).toBe(true);
  });
});
