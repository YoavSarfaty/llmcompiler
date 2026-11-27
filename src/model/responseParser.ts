import { diagnostic, type Diagnostic } from "../types/diagnostics.ts";
import type { CompilePayload, ReviewPayload } from "../types/protocol.ts";
import { validateCompilePayload, validateReviewPayload, type Validation } from "../compiler/validateResult.ts";

interface NormalizedText {
  text: string;
  diagnostics: Diagnostic[];
}

/** Apply the bounded textual normalizations permitted by spec §4.6. */
export function normalizeModelText(raw: string): NormalizedText {
  let text = raw;
  const diagnostics: Diagnostic[] = [];

  if (text.startsWith("\uFEFF")) {
    text = text.slice(1);
    diagnostics.push(
      diagnostic("W005", {
        stage: "normalize",
        message: "A leading BOM was removed from model output.",
      }),
    );
  }

  const fence = text.match(/^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/i);
  if (fence) {
    text = `${fence[1] ?? ""}${text.slice(fence[0].length)}`;
    diagnostics.push(
      diagnostic("W006", {
        stage: "normalize",
        message: "A single markdown code fence was removed from model output.",
      }),
    );
  }

  const finalBrace = text.lastIndexOf("}");
  if (finalBrace >= 0 && text.slice(finalBrace + 1).trim() !== "") {
    text = text.slice(0, finalBrace + 1);
    diagnostics.push(
      diagnostic("W006", {
        stage: "normalize",
        message: "Trailing text after the model response object was removed.",
      }),
    );
  }

  return { text, diagnostics };
}

function parseJson(raw: string, diagnostics: Diagnostic[]): { value?: unknown; diagnostics: Diagnostic[] } {
  try {
    return { value: JSON.parse(raw) as unknown, diagnostics };
  } catch (error) {
    return {
      diagnostics: [
        ...diagnostics,
        diagnostic("E019", {
          stage: "generation",
          message: "Model output is not valid JSON.",
          details: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
  }
}

export function parseCompileResponse(raw: string): Validation<CompilePayload> {
  const normalized = normalizeModelText(raw);
  const parsed = parseJson(normalized.text, normalized.diagnostics);
  if (parsed.value === undefined) return { diagnostics: parsed.diagnostics };
  const validated = validateCompilePayload(parsed.value);
  return { value: validated.value, diagnostics: [...parsed.diagnostics, ...validated.diagnostics] };
}

export function parseReviewResponse(raw: string): Validation<ReviewPayload> {
  const normalized = normalizeModelText(raw);
  const parsed = parseJson(normalized.text, normalized.diagnostics);
  if (parsed.value === undefined) return { diagnostics: parsed.diagnostics };
  const validated = validateReviewPayload(parsed.value);
  return { value: validated.value, diagnostics: [...parsed.diagnostics, ...validated.diagnostics] };
}
