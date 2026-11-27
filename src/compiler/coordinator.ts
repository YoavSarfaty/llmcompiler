import { diagnostic, hasErrors, type Diagnostic } from "../types/diagnostics.ts";
import type { CompileRequest, LlmClient, Note, ReviewPayload } from "../types/protocol.ts";
import { VERSIONS } from "../types/protocol.ts";
import { LIMITS } from "./limits.ts";
import { StageTimeoutError, withStageTimeout } from "./timeout.ts";
import { checkSourceLimits } from "./sourceRanges.ts";
import { validateCompilePayload } from "./validateResult.ts";
import { injectTarget, normalizeRuntimeDeclarations } from "./target.ts";
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
  /** Override stage deadlines in tests; production uses the published limits. */
  timeouts?: { generationMs?: number; reviewMs?: number };
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

type ReviewStageOutcome = { value: ReviewPayload } | { error: unknown };

function inconclusiveReview(input: CompileInput): ReviewPayload {
  return {
    protocolVersion: VERSIONS.protocol,
    schemaVersion: VERSIONS.schema,
    requestId: input.requestId,
    documentVersion: input.documentVersion,
    verdict: "inconclusive",
    checks: {
      controlFlow: "unknown",
      dataFlow: "unknown",
      typesAndConversions: "unknown",
      sideEffects: "unknown",
      ioBehaviour: "unknown",
      termination: "unknown",
    },
    findings: [],
  };
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
  const generationStarted = Date.now();
  let outcome;
  try {
    outcome = await withStageTimeout(
      input.client.compile(buildRequest(input)),
      input.timeouts?.generationMs ?? LIMITS.generationTimeoutMs,
      "generation",
    );
  } catch (error) {
    const timedOut = error instanceof StageTimeoutError;
    diagnostics.push(
      diagnostic(timedOut ? "E015" : "E012", {
        stage: "generation",
        message: timedOut ? "Generation stage timed out." : "Model client failed during generation.",
        details: error instanceof Error ? error.message : String(error),
      }),
    );
    return {
      ...empty,
      diagnostics,
      timings: { intake: generationStarted - started, generation: Date.now() - generationStarted },
    };
  }
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
  const declarations = normalizeRuntimeDeclarations(injected.ir);
  diagnostics.push(...declarations.diagnostics);

  // S9 starts after normalization and overlaps deterministic conformance checks.
  let reviewOperation: Promise<ReviewPayload>;
  try {
    reviewOperation = input.client.review({
      protocolVersion: VERSIONS.protocol,
      requestId: input.requestId,
      documentVersion: input.documentVersion,
      source: input.source,
      ir: declarations.ir,
      notes: payload.notes ?? [],
    });
  } catch (error) {
    reviewOperation = Promise.reject(error);
  }
  const reviewPromise: Promise<ReviewStageOutcome> = withStageTimeout(
    reviewOperation,
    input.timeouts?.reviewMs ?? LIMITS.reviewTimeoutMs,
    "review",
  )
    .then((value): ReviewStageOutcome => ({ value }))
    .catch((error): ReviewStageOutcome => ({ error }));

  // S3 --- conformance, plus the structural half of S4
  const validation = validateIrText(declarations.ir);
  diagnostics.push(...validation.diagnostics);
  if (hasErrors(validation.diagnostics)) {
    return { ...empty, diagnostics, timings: outcome.timings };
  }

  // Mapping resolution
  const resolution = resolveMappings(validation.module, input.source, payload.mappings ?? []);
  diagnostics.push(...resolution.diagnostics);

  // S9 is awaited only after conformance succeeds; failures discard its result.
  const reviewOutcome = await reviewPromise;
  let review: ReviewPayload;
  if ("value" in reviewOutcome) {
    review = reviewOutcome.value;
  } else {
    review = inconclusiveReview(input);
    diagnostics.push(
      diagnostic("W003", {
        stage: "review",
        message: reviewOutcome.error instanceof StageTimeoutError
          ? "Semantic review timed out; its verdict is inconclusive."
          : "Semantic review could not complete; its verdict is inconclusive.",
      }),
    );
  }

  const instructions = allInstructions(validation.module);

  return {
    diagnostics,
    notes: payload.notes ?? [],
    ir: declarations.ir,
    mappings: resolution.mappings,
    instructions,
    review,
    timings: { ...outcome.timings, total: Date.now() - started },
    succeeded: true,
  };
}
