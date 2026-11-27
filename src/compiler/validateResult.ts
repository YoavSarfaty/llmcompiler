import { CODES, diagnostic, type Diagnostic } from "../types/diagnostics.ts";
import type { CompilePayload, ReviewPayload } from "../types/protocol.ts";
import type { IrUpdate } from "./patch.ts";

/**
 * Runtime validation of model output (spec §3.4, §4.2).
 *
 * A response that does not conform is rejected whole with `E019`. The
 * only per-item degradation is an unresolvable mapping anchor, which is
 * handled later by the resolver.
 */

export interface Validation<T> {
  value?: T;
  diagnostics: Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string, details?: string): Diagnostic {
  return diagnostic("E019", { stage: "generation", message, details });
}

function validateDiagnostics(value: unknown): { ok: boolean; diagnostics: Diagnostic[]; errors: Diagnostic[] } {
  if (!Array.isArray(value)) {
    return { ok: false, diagnostics: [], errors: [invalid("`diagnostics` must be an array.")] };
  }
  const out: Diagnostic[] = [];
  const errors: Diagnostic[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(invalid(`diagnostics[${index}] must be an object.`));
      return;
    }
    const code = entry.code;
    const message = entry.message;
    if (typeof code !== "string" || !(code in CODES)) {
      errors.push(invalid(`diagnostics[${index}].code is not a known code.`, String(code)));
      return;
    }
    if (typeof message !== "string" || message.trim() === "") {
      errors.push(invalid(`diagnostics[${index}].message must be a non-empty string.`));
      return;
    }
    out.push({
      code,
      severity: CODES[code]!.severity,
      message,
      details: typeof entry.details === "string" ? entry.details : undefined,
      sourceRanges: Array.isArray(entry.sourceRanges)
        ? entry.sourceRanges.filter(
            (range): range is { from: number; to: number } =>
              isRecord(range) && typeof range.from === "number" && typeof range.to === "number",
          )
        : undefined,
      stage: "generation",
    });
  });
  return { ok: errors.length === 0, diagnostics: out, errors };
}

function validatePatch(value: unknown): value is IrUpdate {
  if (!isRecord(value)) return false;
  if (value.kind === "full") return typeof value.ir === "string";
  if (value.kind !== "patch") return false;
  const named = (entry: unknown): boolean =>
    isRecord(entry) && typeof entry.name === "string" && typeof entry.text === "string";
  const checks: boolean[] = [
    value.replaceFunctions === undefined || (Array.isArray(value.replaceFunctions) && value.replaceFunctions.every(named)),
    value.replaceGlobals === undefined || (Array.isArray(value.replaceGlobals) && value.replaceGlobals.every(named)),
    value.addGlobals === undefined ||
      (Array.isArray(value.addGlobals) && value.addGlobals.every((entry) => typeof entry === "string")),
    value.removeGlobals === undefined ||
      (Array.isArray(value.removeGlobals) && value.removeGlobals.every((entry) => typeof entry === "string")),
    value.replaceDeclarations === undefined ||
      value.replaceDeclarations === null ||
      typeof value.replaceDeclarations === "string",
  ];
  return checks.every(Boolean);
}

function validateMappings(value: unknown): { ok: boolean; errors: Diagnostic[] } {
  if (!Array.isArray(value)) {
    return { ok: false, errors: [invalid("`mappings` must be an array.")] };
  }
  const errors: Diagnostic[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(invalid(`mappings[${index}] must be an object.`));
      return;
    }
    if (typeof entry.semanticId !== "string" || entry.semanticId.trim() === "") {
      errors.push(invalid(`mappings[${index}].semanticId must be a non-empty string.`));
      return;
    }
    if (seen.has(entry.semanticId)) {
      errors.push(invalid(`mappings[${index}].semanticId is duplicated.`, entry.semanticId));
    }
    seen.add(entry.semanticId);
    if (
      !Array.isArray(entry.sourceRanges) ||
      !entry.sourceRanges.every(
        (range) => isRecord(range) && typeof range.from === "number" && typeof range.to === "number",
      )
    ) {
      errors.push(invalid(`mappings[${index}].sourceRanges must be an array of {from,to}.`));
    }
    if (
      !Array.isArray(entry.irRefs) ||
      !entry.irRefs.every(
        (ref) => isRecord(ref) && typeof ref.function === "string" && typeof ref.anchor === "string",
      )
    ) {
      errors.push(invalid(`mappings[${index}].irRefs must be an array of {function,anchor}.`));
    }
    if (
      entry.confidence !== undefined &&
      entry.confidence !== "high" &&
      entry.confidence !== "medium" &&
      entry.confidence !== "low"
    ) {
      errors.push(invalid(`mappings[${index}].confidence must be high, medium or low.`));
    }
  });
  return { ok: errors.length === 0, errors };
}

export function validateCompilePayload(value: unknown): Validation<CompilePayload> {
  if (!isRecord(value)) {
    return { diagnostics: [invalid("Model output must be a JSON object.")] };
  }

  const errors: Diagnostic[] = [];
  if (value.protocolVersion !== 1) errors.push(invalid("Unsupported `protocolVersion`.", String(value.protocolVersion)));
  if (value.schemaVersion !== 1) errors.push(invalid("Unsupported `schemaVersion`.", String(value.schemaVersion)));
  if (typeof value.requestId !== "string") errors.push(invalid("`requestId` must be a string."));
  if (typeof value.documentVersion !== "number") errors.push(invalid("`documentVersion` must be a number."));
  if (value.status !== "success" && value.status !== "error") {
    errors.push(invalid("`status` must be `success` or `error`."));
  }

  const diagnosticResult = validateDiagnostics(value.diagnostics);
  errors.push(...diagnosticResult.errors);

  if (value.status === "success") {
    if (value.ir === undefined) {
      errors.push(invalid("Successful response is missing `ir`."));
    } else if (typeof value.ir !== "string" && !validatePatch(value.ir)) {
      errors.push(invalid("`ir` must be a module string or a well-formed patch object."));
    }
    if (value.mappings === undefined) {
      errors.push(invalid("Successful response is missing `mappings` (use an empty array)."));
    } else {
      errors.push(...validateMappings(value.mappings).errors);
    }
  } else if (value.status === "error") {
    const hasError = diagnosticResult.diagnostics.some((entry) => entry.severity === "error");
    if (!hasError) errors.push(invalid("Error response must carry at least one error diagnostic."));
    if (value.ir !== undefined) errors.push(invalid("Error response must not carry `ir`."));
  }

  if (errors.length > 0) {
    return { diagnostics: errors };
  }

  return {
    value: value as unknown as CompilePayload,
    diagnostics: diagnosticResult.diagnostics,
  };
}

export function validateReviewPayload(value: unknown): Validation<ReviewPayload> {
  if (!isRecord(value)) {
    return { diagnostics: [invalid("Review output must be a JSON object.")] };
  }
  const errors: Diagnostic[] = [];
  if (value.verdict !== "pass" && value.verdict !== "fail" && value.verdict !== "inconclusive") {
    errors.push(invalid("`verdict` must be pass, fail or inconclusive."));
  }
  if (!isRecord(value.checks)) {
    errors.push(invalid("`checks` must be an object."));
  }
  if (!Array.isArray(value.findings)) {
    errors.push(invalid("`findings` must be an array."));
  }
  if (errors.length > 0) return { diagnostics: errors };
  return { value: value as unknown as ReviewPayload, diagnostics: [] };
}
