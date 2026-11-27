/**
 * Small, dependency-free helpers for scanning textual LLVM IR.
 *
 * Everything here is deliberately conservative: it never attempts to
 * interpret IR semantics, only to make the text safe to scan for
 * structural properties. Semantic judgement belongs to LLVM.
 */

/** Replace the contents of `c"..."` string literals with spaces, preserving length. */
export function blankStringLiterals(line: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (!inString) {
      if (ch === '"') {
        inString = true;
        out += '"';
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += '"';
    } else {
      out += " ";
    }
  }
  return out;
}

/** Remove a trailing `;` comment that is not inside a string literal. */
export function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && ch === ";") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Comment-free, string-free view of a line, for structural scanning. */
export function analyzeLine(line: string): string {
  return blankStringLiterals(stripComment(line));
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The canonical comparison form of an instruction. */
export function normalizeInstruction(text: string): string {
  return collapseWhitespace(blankStringLiterals(stripComment(text)));
}

export function countChar(text: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ch) count++;
  }
  return count;
}

/** Net `{` minus `}` depth contribution of a line. */
export function braceDepthDelta(line: string): number {
  return countChar(line, "{") - countChar(line, "}");
}

/** Net depth across all bracketing pairs, for multi-line globals. */
export function bracketDepthDelta(line: string): number {
  return (
    countChar(line, "{") -
    countChar(line, "}") +
    countChar(line, "[") -
    countChar(line, "]") +
    countChar(line, "(") -
    countChar(line, ")") +
    countChar(line, "<") -
    countChar(line, ">")
  );
}

const SYMBOL = /@(?:"([^"]+)"|([A-Za-z$._][\w$.-]*))/;

/** Extract a global or function symbol name from a line, without the `@`. */
export function extractSymbol(line: string): string | null {
  const match = SYMBOL.exec(line);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/** Extract a local symbol name (`%name` or `%0`). */
export function extractLocalSymbol(line: string): string | null {
  const match = /%([A-Za-z$._][\w$.-]*|\d+)/.exec(line);
  if (!match) return null;
  return match[1] ?? null;
}
