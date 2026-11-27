import { diagnostic, type Diagnostic, type Stage } from "../types/diagnostics.ts";

export interface ToolchainInfo {
  toolchainVersion: string;
  abiVersion: number;
  irSubsetVersion: number;
  targetTriple: string;
  dataLayout: string;
  sysrootVersion: string;
}

export interface ToolchainResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export interface LinkResult extends ToolchainResult {
  wasm?: Uint8Array;
}

export interface ToolchainAdapter {
  init(): Promise<ToolchainInfo>;
  parse(ir: string): Promise<ToolchainResult>;
  verify(ir: string): Promise<ToolchainResult>;
  compile(ir: string, options: { optimize: boolean }): Promise<LinkResult>;
}

export class ToolchainUnavailableError extends Error {
  readonly code = "E012";

  constructor(message: string) {
    super(message);
    this.name = "ToolchainUnavailableError";
  }
}

const TOOLCHAIN_UNAVAILABLE_REASON =
  "The browser LLVM artifact is not installed. No LLVM parsing, verification, code generation, linking, or execution is available.";

/** Fail-closed adapter used until a real Phase 0 toolchain artifact is integrated. */
export class UnavailableToolchain implements ToolchainAdapter {
  async init(): Promise<ToolchainInfo> {
    throw new ToolchainUnavailableError(TOOLCHAIN_UNAVAILABLE_REASON);
  }

  async parse(_ir: string): Promise<ToolchainResult> {
    return this.unavailable("parse");
  }

  async verify(_ir: string): Promise<ToolchainResult> {
    return this.unavailable("verify");
  }

  async compile(_ir: string, _options: { optimize: boolean }): Promise<LinkResult> {
    return this.unavailable("link");
  }

  private unavailable(stage: Stage): ToolchainResult {
    return {
      ok: false,
      diagnostics: [
        diagnostic("E012", {
          stage,
          message: "LLVM toolchain unavailable.",
          details: TOOLCHAIN_UNAVAILABLE_REASON,
        }),
      ],
    };
  }
}

export const TOOLCHAIN_STATUS = {
  available: false,
  reason: TOOLCHAIN_UNAVAILABLE_REASON,
} as const;