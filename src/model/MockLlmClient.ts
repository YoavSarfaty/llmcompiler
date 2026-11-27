import type { Diagnostic } from "../types/diagnostics.ts";
import { diagnostic } from "../types/diagnostics.ts";
import type {
  CompileOutcome,
  CompilePayload,
  CompileRequest,
  LlmClient,
  ModelCapabilities,
  ReviewPayload,
  ReviewRequest,
} from "../types/protocol.ts";
import { FIB_IR, rangeOf } from "./fibFixture.ts";
import type { RawMapping } from "../compiler/mappingResolver.ts";

/**
 * Deterministic stand-in for the local model (decisions.md D-09).
 *
 * CI has no GPU, so every automated test runs against this client. It
 * reproduces the behaviours the real model must have: a valid compile,
 * prompt-only rejection, and an honest error for anything it does not
 * know. It never invents IR for unrecognised input.
 */

const REQUEST_PATTERNS: readonly RegExp[] = [
  /\bmake me\b/i,
  /\bwrite (me )?a (program|function|script|compiler)\b/i,
  /\bgenerate (a |me )?(program|code|function)\b/i,
  /\bcreate (a |me )?(program|function|script)\b/i,
  /\bcan you (write|make|build|create)\b/i,
  /\bi want (you )?to (write|make|build|create)\b/i,
  /\bplease (write|make|build|create)\b/i,
];

export function looksLikeRequest(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed === "") return true;
  return REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isReferenceProgram(source: string): boolean {
  const normalized = source.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.includes("fib") && normalized.includes("takes number x");
}

function referenceMappings(source: string): RawMapping[] {
  return [
    {
      semanticId: "fib.base-case",
      sourceRanges: [rangeOf(source, "If x is 0 or 1 return 1")],
      irRefs: [{ function: "fib", anchor: "ret i64 1" }],
      confidence: "high",
    },
    {
      semanticId: "fib.recurse",
      sourceRanges: [rangeOf(source, "Else return fib of x-1 plus fib of x-2")],
      irRefs: [
        { function: "fib", anchor: "%a = sub i64 %x, 1" },
        { function: "fib", anchor: "%fa = call i64 @fib(i64 %a)" },
        { function: "fib", anchor: "%b = sub i64 %x, 2" },
        { function: "fib", anchor: "%fb = call i64 @fib(i64 %b)" },
        { function: "fib", anchor: "%sum = add i64 %fa, %fb" },
      ],
      confidence: "high",
    },
    {
      semanticId: "main.prompt",
      sourceRanges: [rangeOf(source, `Ask user "what's you number dude:\\n"`)],
      irRefs: [{ function: "main", anchor: "%p = call i32 (ptr, ...) @printf(ptr @.prompt)" }],
      confidence: "high",
    },
    {
      semanticId: "main.read",
      sourceRanges: [rangeOf(source, "Take user input number")],
      irRefs: [
        { function: "main", anchor: "%r = call i32 (ptr, ...) @scanf(ptr @.infmt, ptr %buf)" },
        { function: "main", anchor: "%n = load i64, ptr %buf, align 8" },
      ],
      confidence: "high",
    },
    {
      semanticId: "main.print",
      sourceRanges: [rangeOf(source, "Print fib of user input")],
      irRefs: [
        { function: "main", anchor: "%f = call i64 @fib(i64 %n)" },
        { function: "main", anchor: "%o = call i32 (ptr, ...) @printf(ptr @.outfmt, i64 %f)" },
      ],
      confidence: "high",
    },
  ];
}

function errorPayload(request: CompileRequest, diagnostics: Diagnostic[]): CompilePayload {
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    requestId: request.requestId,
    documentVersion: request.documentVersion,
    status: "error",
    diagnostics,
  };
}

export class MockLlmClient implements LlmClient {
  async capabilities(): Promise<ModelCapabilities> {
    return {
      available: true,
      modelId: "mock:reference-fib",
      contextWindow: 16_384,
      webgpu: false,
      reason: "Deterministic mock client; no model weights are loaded.",
    };
  }

  async compile(request: CompileRequest): Promise<CompileOutcome> {
    const started = Date.now();
    const source = request.source;

    if (looksLikeRequest(source)) {
      return {
        payload: errorPayload(request, [
          diagnostic("E001", {
            stage: "generation",
            message: "Source input error: expected user-written code; received a program-generation request.",
            details: "Enter a program, not a request to create one.",
            sourceRanges: [{ from: 0, to: source.length }],
          }),
        ]),
        timings: { generation: Date.now() - started },
      };
    }

    if (isReferenceProgram(source)) {
      return {
        payload: {
          protocolVersion: 1,
          schemaVersion: 1,
          requestId: request.requestId,
          documentVersion: request.documentVersion,
          status: "success",
          ir: FIB_IR,
          mappings: referenceMappings(source),
          dependencies: {
            functions: ["fib", "main"],
            globals: [".prompt", ".infmt", ".outfmt"],
            runtime: ["printf", "scanf"],
          },
          notes: [
            {
              code: "N001",
              severity: "info",
              message: "'Takes number x' resolved to i64: the program compares exactly and prints an integer.",
              sourceRanges: [rangeOf(source, "Takes number x")],
            },
          ],
          diagnostics: [],
        },
        timings: { generation: Date.now() - started },
      };
    }

    return {
      payload: errorPayload(request, [
        diagnostic("E002", {
          stage: "generation",
          message: "The mock client only compiles the reference Fibonacci program.",
          details:
            "This build has no model weights. Enter the reference program, or use a build with the local model.",
          sourceRanges: [{ from: 0, to: Math.min(source.length, 120) }],
        }),
      ]),
      timings: { generation: Date.now() - started },
    };
  }

  async review(request: ReviewRequest): Promise<ReviewPayload> {
    const known = request.ir.includes("define i64 @fib(") && isReferenceProgram(request.source);
    return {
      protocolVersion: 1,
      schemaVersion: 1,
      requestId: request.requestId,
      documentVersion: request.documentVersion,
      verdict: known ? "pass" : "inconclusive",
      checks: {
        controlFlow: known ? "pass" : "unknown",
        dataFlow: known ? "pass" : "unknown",
        typesAndConversions: known ? "pass" : "unknown",
        sideEffects: known ? "pass" : "unknown",
        ioBehaviour: known ? "pass" : "unknown",
        termination: known ? "pass" : "unknown",
      },
      findings: known
        ? []
        : [
            diagnostic("E006", {
              stage: "review",
              message: "The mock reviewer has no reference for this program.",
            }),
          ],
    };
  }
}
