import type { Diagnostic } from "../types/diagnostics.ts";
import { parseIrModule, type IrModule } from "./irSpans.ts";
import { checkSubset } from "./subsetChecker.ts";
import { checkAbi } from "./abiChecker.ts";

export interface IrValidation {
  module: IrModule;
  diagnostics: Diagnostic[];
}

/**
 * Structural validation available without LLVM: parse, subset, ABI.
 *
 * Structural verification proper (LLVM's verifier) is a separate stage
 * and requires the toolchain worker.
 */
export function validateIrText(text: string): IrValidation {
  const module = parseIrModule(text);
  return {
    module,
    diagnostics: [...checkSubset(module), ...checkAbi(module)],
  };
}
