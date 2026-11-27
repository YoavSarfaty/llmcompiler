import { describe, expect, it } from "vitest";
import { checkAbi } from "../../src/compiler/abiChecker.ts";
import { parseIrModule } from "../../src/compiler/irSpans.ts";
import { checkSubset } from "../../src/compiler/subsetChecker.ts";
import { parseCompileResponse } from "../../src/model/responseParser.ts";
import { fixture } from "../helpers.ts";

describe("documented model and IR fixtures", () => {
  it("parses prompt-only and oversized error responses", () => {
    const prompt = parseCompileResponse(fixture("model", "prompt-only.json"));
    const oversized = parseCompileResponse(fixture("model", "oversized.json"));

    expect(prompt.value?.status).toBe("error");
    expect(prompt.value?.diagnostics[0]?.code).toBe("E001");
    expect(oversized.value?.diagnostics[0]?.code).toBe("E014");
  });

  it("rejects typed pointers and missing main in the structural gate", () => {
    const typed = parseCompileResponse(fixture("model", "typed-pointer.json"));
    const missingMain = parseCompileResponse(fixture("model", "missing-main.json"));

    expect(typed.value?.status).toBe("success");
    expect(checkSubset(parseIrModule(typed.value!.ir as string)).some((item) => item.code === "E018")).toBe(true);
    expect(checkSubset(parseIrModule(missingMain.value!.ir as string)).some((item) => item.message.includes("no `main`"))).toBe(true);
  });

  it("accepts variadic printf IR and leaves unknown symbols to the linker", () => {
    const printfIr = fixture("ir", "printf-varargs.ll");
    const undefinedSymbolIr = fixture("ir", "undefined-symbol.ll");

    expect(checkSubset(parseIrModule(printfIr))).toEqual([]);
    expect(checkAbi(parseIrModule(printfIr))).toEqual([]);
    expect(checkSubset(parseIrModule(undefinedSymbolIr))).toEqual([]);
    expect(checkAbi(parseIrModule(undefinedSymbolIr))).toEqual([]);
  });
});
