import { diagnostic, type Diagnostic, type SourceRange } from "../types/diagnostics.ts";
import { LIMITS } from "./limits.ts";

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * A range is valid when it is ordered, inside the document, and does not
 * split a surrogate pair (spec §2.5).
 */
export function isValidSourceRange(text: string, range: SourceRange): boolean {
  const { from, to } = range;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || to < 0) return false;
  if (from > to) return false;
  if (to > text.length) return false;
  if (from < text.length && from > 0) {
    if (isLowSurrogate(text.charCodeAt(from)) && isHighSurrogate(text.charCodeAt(from - 1))) {
      return false;
    }
  }
  if (to < text.length && to > 0) {
    if (isLowSurrogate(text.charCodeAt(to)) && isHighSurrogate(text.charCodeAt(to - 1))) {
      return false;
    }
  }
  return true;
}

/** 1-based line and column, both counting UTF-16 code units. */
export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

export function lineColumnToOffset(text: string, line: number, column: number): number {
  if (line < 1) return 0;
  let currentLine = 1;
  let index = 0;
  while (currentLine < line && index < text.length) {
    if (text.charCodeAt(index) === 10) currentLine++;
    index++;
  }
  if (currentLine !== line) return text.length;
  return Math.min(index + Math.max(0, column - 1), text.length);
}

export function checkSourceLimits(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const bytes = utf8ByteLength(text);
  if (bytes > LIMITS.maxSourceBytes) {
    diagnostics.push(
      diagnostic("E014", {
        stage: "intake",
        message: `Source is ${bytes} bytes; the limit is ${LIMITS.maxSourceBytes}.`,
        details: "Split the program or reduce its size. Input is never truncated silently.",
      }),
    );
  }
  const lines = countLines(text);
  if (lines > LIMITS.maxSourceLines) {
    diagnostics.push(
      diagnostic("E014", {
        stage: "intake",
        message: `Source has ${lines} lines; the limit is ${LIMITS.maxSourceLines}.`,
      }),
    );
  }
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    diagnostics.push(
      diagnostic("W005", {
        stage: "intake",
        message: "Source begins with a byte-order mark.",
        details: "The mark is treated as part of the text, so offsets include it.",
        sourceRanges: [{ from: 0, to: 1 }],
      }),
    );
  }
  return diagnostics;
}
