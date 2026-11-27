import {
  analyzeLine,
  braceDepthDelta,
  bracketDepthDelta,
  extractSymbol,
  normalizeInstruction,
} from "./irText.ts";

/**
 * Line-based structural view of a textual LLVM module.
 *
 * This is not an LLVM parser. It locates top-level constructs and their
 * text spans so that the application can splice patches without brace
 * counting by hand, and so that diagnostics can point at a line.
 */

export interface Span {
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

export interface FunctionSpan extends Span {
  name: string;
  header: string;
  text: string;
}

export interface GlobalSpan extends Span {
  name: string;
  text: string;
}

export interface DeclarationSpan extends Span {
  symbol: string;
  text: string;
}

export interface StructuralProblem {
  message: string;
  line: number;
}

export interface IrModule {
  text: string;
  lines: string[];
  functions: FunctionSpan[];
  globals: GlobalSpan[];
  declarations: DeclarationSpan[];
  structuralErrors: StructuralProblem[];
}

export interface InstructionRef {
  /** `fn:<function>#<ordinal>`, application-owned. */
  id: string;
  function: string;
  ordinal: number;
  line: number;
  text: string;
  normalized: string;
}

const LABEL = /^(?:[A-Za-z$._][\w$.-]*|\d+):\s*$/;
const ATTRIBUTE_GROUP = /^attributes\s+#\d+\s*=/;
const NAMED_TYPE = /^%[A-Za-z$._][\w$.-]*\s*=\s*type\b/;
const COMDAT = /^\$[A-Za-z$._][\w$.-]*\s*=/;

export function parseIrModule(text: string): IrModule {
  const lines = text.split(/\r?\n/);
  const functions: FunctionSpan[] = [];
  const globals: GlobalSpan[] = [];
  const declarations: DeclarationSpan[] = [];
  const structuralErrors: StructuralProblem[] = [];

  const lineAt = (index: number): string => lines[index] ?? "";

  let i = 0;
  while (i < lines.length) {
    const raw = lineAt(i);
    const analyzed = analyzeLine(raw).trim();

    if (analyzed === "" || analyzed.startsWith(";")) {
      i++;
      continue;
    }

    if (analyzed.startsWith("define ")) {
      const name = extractSymbol(analyzed);
      const braceIndex = analyzed.indexOf("{");
      const header = (braceIndex === -1 ? analyzed : analyzed.slice(0, braceIndex)).trim();
      let depth = braceDepthDelta(analyzed);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        depth += braceDepthDelta(analyzeLine(lineAt(j)));
      }
      if (depth !== 0) {
        structuralErrors.push({
          message: `Unterminated function body${name ? ` for @${name}` : ""}.`,
          line: i + 1,
        });
      }
      if (name === null) {
        structuralErrors.push({ message: "Function definition has no name.", line: i + 1 });
      } else {
        functions.push({
          name,
          header,
          startLine: i + 1,
          endLine: j + 1,
          text: lines.slice(i, j + 1).join("\n"),
        });
      }
      i = j + 1;
      continue;
    }

    if (analyzed.startsWith("declare ")) {
      let j = i;
      while (analyzeLine(lineAt(j)).trimEnd().endsWith(",") && j + 1 < lines.length) {
        j++;
      }
      const symbol = extractSymbol(analyzed);
      if (symbol === null) {
        structuralErrors.push({ message: "Declaration has no symbol name.", line: i + 1 });
      } else {
        declarations.push({
          symbol,
          startLine: i + 1,
          endLine: j + 1,
          text: lines.slice(i, j + 1).join("\n"),
        });
      }
      i = j + 1;
      continue;
    }

    if (analyzed.startsWith("@") && analyzed.includes("=")) {
      const name = extractSymbol(analyzed);
      let depth = bracketDepthDelta(analyzed);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        depth += bracketDepthDelta(analyzeLine(lineAt(j)));
      }
      if (depth !== 0) {
        structuralErrors.push({
          message: `Unbalanced global initializer${name ? ` for @${name}` : ""}.`,
          line: i + 1,
        });
      }
      if (name !== null) {
        globals.push({ name, startLine: i + 1, endLine: j + 1, text: lines.slice(i, j + 1).join("\n") });
      }
      i = j + 1;
      continue;
    }

    if (ATTRIBUTE_GROUP.test(analyzed) || NAMED_TYPE.test(analyzed) || COMDAT.test(analyzed)) {
      // Skip attribute groups, named types and comdats; they are not spliced.
      let depth = bracketDepthDelta(analyzed);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        depth += bracketDepthDelta(analyzeLine(lineAt(j)));
      }
      i = j + 1;
      continue;
    }

    i++;
  }

  return { text, lines, functions, globals, declarations, structuralErrors };
}

/**
 * Instructions of a function body, in order, excluding labels, blank
 * lines and comment-only lines. Ordinals are 0-based and count only
 * instructions, including terminators.
 */
export function functionInstructions(module: IrModule, functionName: string): InstructionRef[] {
  const fn = module.functions.find((f) => f.name === functionName);
  if (!fn) return [];
  const instructions: InstructionRef[] = [];
  let ordinal = 0;
  for (let line = fn.startLine + 1; line <= fn.endLine - 1; line++) {
    const raw = module.lines[line - 1] ?? "";
    const analyzed = analyzeLine(raw).trim();
    if (analyzed === "" || analyzed.startsWith(";")) continue;
    if (LABEL.test(analyzed)) continue;
    instructions.push({
      id: `fn:${functionName}#${ordinal}`,
      function: functionName,
      ordinal,
      line,
      text: raw.trim(),
      normalized: normalizeInstruction(raw),
    });
    ordinal++;
  }
  return instructions;
}

export function allInstructions(module: IrModule): InstructionRef[] {
  return module.functions.flatMap((fn) => functionInstructions(module, fn.name));
}

export function findFunction(module: IrModule, name: string): FunctionSpan | undefined {
  return module.functions.find((f) => f.name === name);
}
