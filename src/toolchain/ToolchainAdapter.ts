import type { Diagnostic } from "../types/diagnostics.ts";

/**
 * The toolchain seam (decisions.md D-01).
 *
 * Both Phase 0 candidates implement this interface, so the coordinator
 * does not know or care whether LLVM runs as WASI CLI tools or as an
 * in-process library.
 */

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

/**
 * Current build status. Flipped when the Phase 0 artifact lands.
 */
export const TOOLCHAIN_STATUS = {
  available: false,
  reason:
    "The browser LLVM toolchain is not part of this build. Structural checks run locally; verification, code generation, linking and execution are disabled.",
} as const;
