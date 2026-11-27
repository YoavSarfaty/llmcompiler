import type { Diagnostic, Severity, SourceRange } from "./diagnostics.ts";
import type { IrUpdate } from "../compiler/patch.ts";
import type { Confidence, RawMapping } from "../compiler/mappingResolver.ts";

/** Version identifiers (spec §0.1). */
export const VERSIONS = {
  protocol: 1,
  schema: 1,
  abi: 1,
  irSubset: 1,
  prompt: 1,
  reviewPrompt: 1,
} as const;

export interface DependencySet {
  functions: string[];
  globals: string[];
  runtime: string[];
}

export interface Note {
  code: string;
  severity: Severity;
  message: string;
  sourceRanges?: SourceRange[];
}

export interface CompileRequest {
  protocolVersion: number;
  requestId: string;
  documentVersion: number;
  mode: "full" | "incremental";
  source: string;
  changedRanges: SourceRange[];
  previous: {
    ir: string;
    irVersion: number;
    mappings: RawMapping[];
    dependencies: DependencySet;
  } | null;
  dependencies: DependencySet;
  versions: {
    promptVersion: number;
    reviewPromptVersion: number;
    schemaVersion: number;
    irSubsetVersion: number;
    abiVersion: number;
  };
  limits: {
    maxSourceBytes: number;
    maxOutputTokens: number;
  };
}

export interface CompilePayload {
  protocolVersion: number;
  schemaVersion: number;
  requestId: string;
  documentVersion: number;
  status: "success" | "error";
  ir?: string | IrUpdate;
  mappings?: RawMapping[];
  dependencies?: DependencySet;
  notes?: Note[];
  diagnostics: Diagnostic[];
}

export interface ReviewRequest {
  protocolVersion: number;
  requestId: string;
  documentVersion: number;
  source: string;
  ir: string;
  notes: Note[];
}

export type ReviewVerdict = "pass" | "fail" | "inconclusive";
export type CheckResult = "pass" | "fail" | "unknown";

export interface ReviewPayload {
  protocolVersion: number;
  schemaVersion: number;
  requestId: string;
  documentVersion: number;
  verdict: ReviewVerdict;
  checks: {
    controlFlow: CheckResult;
    dataFlow: CheckResult;
    typesAndConversions: CheckResult;
    sideEffects: CheckResult;
    ioBehaviour: CheckResult;
    termination: CheckResult;
  };
  findings: Diagnostic[];
}

export interface ModelCapabilities {
  available: boolean;
  modelId: string;
  contextWindow: number;
  webgpu: boolean;
  reason?: string;
}

export interface CompileOutcome {
  payload: CompilePayload;
  timings: Record<string, number>;
}

export interface LlmClient {
  capabilities(): Promise<ModelCapabilities>;
  compile(request: CompileRequest): Promise<CompileOutcome>;
  review(request: ReviewRequest): Promise<ReviewPayload>;
}

export type { Confidence };
