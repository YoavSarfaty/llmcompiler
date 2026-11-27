import { hasErrors, type Diagnostic } from "../types/diagnostics.ts";
import type { CompileRequest, LlmClient, Note, ReviewPayload } from "../types/protocol.ts";
import { VERSIONS } from "../types/protocol.ts";
import { LIMITS } from "./limits.ts";
import { checkSourceLimits } from "./sourceRanges.ts";
import { validateCompilePayload } from "./validateResult.ts";
import { injectTarget } from "./target.ts";
import { validateIrText } from "./validateIr.ts";
import { resolveMappings, type ResolvedMapping } from "./mappingResolver.ts";
import { allInstructions, type InstructionRef } from "./irSpans.ts";

/**
 * One compilation pass, end to end (spec §1.1).
 *
 * Stages that require LLVM (verify, codegen, link) are not run here;
 * the toolchain worker owns those and is not available in this build.
 */

export interface CompileInput {
  source: string;
  documentVersion: number;
  requestId: string;
  client: LlmClient;
}

export interface CompileOutput {
  diagnostics: Diagnostic[];
  notes: Note[];
  ir: string | null;
  mappings: ResolvedMapping[];
  instructions: InstructionRef[];
  review: ReviewPayload | null;
  timings: Record<string, number>;
  succeeded: boolean;
}

const emptyDependencies = () => ({ functions: [], globals: [], runtime: [] });

function buildRequest(input: CompileInput): CompileRequest {
  return {
    protocolVersion: VERSIONS.protocol,
    requestId: input.requestId,
    documentVersion: input.documentVersion,
    mode: "full",
    source: input.source,
    changedRanges: [],
    previous: null,
    dependencies: emptyDependencies(),
    versions: {
      promptVersion: VERSIONS.prompt,
      reviewPromptVersion: VERSIONS.reviewPrompt,
      schemaVersion: VERSIONS.schema,
      irSubsetVersion: VERSIONS.irSubset,
      abiVersion: VERSIONS.abi,
    },
    limits: {
      maxSourceBytes: LIMITS.maxSourceBytes,
      maxOutputTokens: LIMITS.maxOutputTokens,
    },
  };
}

export async function runCompilation(input: CompileInput): Promise<CompileOutput> {
  const started = Date.now();
  const diagnostics: Diagnostic[] = [];
  const empty: CompileOutput = {
    diagnostics,
    notes: [],
    ir: null,
    mappings: [],
    instructions: [],
    review: null,
    timings: {},
    succeeded: false,
  };

  // S0 --- intake
  const intake = checkSourceLimits(input.source);
  diagnostics.push(...intake);
  if (hasErrors(intake)) {
    return { ...empty, timings: { intake: Date.now() - started } };
  }
  if (input.source.trim() === "") {
    return { ...empty, timings: { intake: Date.now() - started } };
  }

  // S1 --- generation
  const outcome = await input.client.compile(buildRequest(input));
  const validated = validateCompilePayload(outcome.payload);
  if (!validated.value) {
    diagnostics.push(...validated.diagnostics);
    return { ...empty, diagnostics, timings: { ...outcome.timings, generation: Date.now() - started } };
  }

  const payload = validated.value;
  diagnostics.push(...validated.diagnostics);

  if (payload.status === "error") {
    return { ...empty, diagnostics, timings: outcome.timings };
  }

  // S2 --- normalization
  const rawIr = payload.ir;
  if (rawIr === undefined) {
    diagnostics.push({
      code: "E019",
      severity: "error",
      message: "Successful response carried no IR.",
      stage: "generation",
    });
    return { ...empty, diagnostics, timings: outcome.timings };
  }
  if (typeof rawIr !== "string") {
    diagnostics.push({
      code: "E019",
      severity: "error",
      message: "A patch response is not valid for a full compilation.",
      stage: "generation",
    });
    return { ...empty, diagnostics, timings: outcome.timings };
  }

  const injected = injectTarget(rawIr);
  diagnostics.push(...injected.diagnostics);

  // S3 --- conformance, plus the structural half of S4
  const validation = validateIrText(injected.ir);
  diagnostics.push(...validation.diagnostics);
  if (hasErrors(validation.diagnostics)) {
    return { ...empty, diagnostics, timings: outcome.timings };
  }

  // Mapping resolution
  const resolution = resolveMappings(validation.module, input.source, payload.mappings ?? []);
  diagnostics.push(...resolution.diagnostics);

  // S9 --- review (dispatched after IR exists; gates execution only)
  let review: ReviewPayload | null = null;
  try {
    review = await input.client.review({
      protocolVersion: VERSIONS.protocol,
      requestId: input.requestId,
      documentVersion: input.documentVersion,
      source: input.source,
      ir: injected.ir,
      notes: payload.notes ?? [],
    });
  } catch {
    review = null;
  }

  const instructions = allInstructions(validation.module);

  return {
    diagnostics,
    notes: payload.notes ?? [],
    ir: injected.ir,
    mappings: resolution.mappings,
    instructions,
    review,
    timings: { ...outcome.timings, total: Date.now() - started },
    succeeded: true,
  };
}
