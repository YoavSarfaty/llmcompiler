import { diagnostic, type Diagnostic, type SourceRange } from "../types/diagnostics.ts";
import { functionInstructions, type IrModule } from "./irSpans.ts";
import { isValidSourceRange } from "./sourceRanges.ts";

/**
 * Resolves model-supplied instruction anchors into application-owned
 * instruction identities (spec §4.3).
 *
 * The model writes instruction text; the application decides what it
 * points at. An anchor that does not resolve is dropped with `W001`
 * rather than guessed.
 */

export type Confidence = "high" | "medium" | "low";

export interface RawIrRef {
  function: string;
  anchor: string;
}

export interface RawMapping {
  semanticId: string;
  sourceRanges: SourceRange[];
  irRefs: RawIrRef[];
  confidence?: Confidence;
}

export interface ResolvedMapping {
  semanticId: string;
  sourceRanges: SourceRange[];
  instructionIds: string[];
  confidence: Confidence;
}

export interface ResolutionResult {
  mappings: ResolvedMapping[];
  diagnostics: Diagnostic[];
}

export function resolveMappings(
  module: IrModule,
  source: string,
  rawMappings: readonly RawMapping[],
): ResolutionResult {
  const mappings: ResolvedMapping[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const raw of rawMappings) {
    // Occurrence consumption is local to one mapping. A different mapping may
    // legitimately reference the same instruction (many-to-many relation).
    const cursors = new Map<string, number>();
    const validRanges: SourceRange[] = [];
    for (const range of raw.sourceRanges) {
      if (isValidSourceRange(source, range)) {
        validRanges.push(range);
      } else {
        diagnostics.push(
          diagnostic("W001", {
            stage: "normalize",
            message: `Mapping "${raw.semanticId}" has an invalid source range and it was dropped.`,
            details: `Range ${range.from}..${range.to} is outside the source or splits a surrogate pair.`,
          }),
        );
      }
    }

    const instructionIds: string[] = [];
    for (const ref of raw.irRefs) {
      const instructions = functionInstructions(module, ref.function);
      if (instructions.length === 0) {
        diagnostics.push(
          diagnostic("W001", {
            stage: "normalize",
            message: `Mapping "${raw.semanticId}" references unknown function @${ref.function}.`,
          }),
        );
        continue;
      }
      const anchor = ref.anchor.replace(/\s+/g, " ").trim();
      const start = cursors.get(ref.function) ?? 0;
      let found: string | null = null;
      let foundIndex = -1;
      for (let index = start; index < instructions.length; index++) {
        if (instructions[index]!.normalized === anchor) {
          found = instructions[index]!.id;
          foundIndex = index;
          break;
        }
      }
      if (found === null) {
        diagnostics.push(
          diagnostic("W001", {
            stage: "normalize",
            message: `Mapping "${raw.semanticId}" has an anchor that does not resolve.`,
            details: `Function @${ref.function}, anchor: ${anchor}`,
          }),
        );
        continue;
      }
      cursors.set(ref.function, foundIndex + 1);
      instructionIds.push(found);
    }

    if (validRanges.length === 0 && instructionIds.length === 0) {
      continue;
    }

    mappings.push({
      semanticId: raw.semanticId,
      sourceRanges: validRanges,
      instructionIds,
      confidence: raw.confidence ?? "medium",
    });
  }

  return { mappings, diagnostics };
}
