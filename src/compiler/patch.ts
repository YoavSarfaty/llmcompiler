import { diagnostic, hasErrors, type Diagnostic } from "../types/diagnostics.ts";
import { parseIrModule } from "./irSpans.ts";
import { validateIrText } from "./validateIr.ts";

/**
 * Transactional application of an incremental IR patch (spec §4.8).
 *
 * Edits are line spans recorded by the parser, never brace counting.
 * Untouched text is preserved byte-for-byte. A patch that does not
 * survive validation is discarded whole; the caller falls back to a full
 * compilation and emits `W008`.
 */

export interface IrPatch {
  kind: "patch";
  replaceFunctions?: { name: string; text: string }[];
  replaceGlobals?: { name: string; text: string }[];
  addGlobals?: string[];
  removeGlobals?: string[];
  replaceDeclarations?: string | null;
}

export type IrUpdate = { kind: "full"; ir: string } | IrPatch;

export interface PatchOutcome {
  ok: boolean;
  ir: string;
  diagnostics: Diagnostic[];
}

interface Edit {
  start: number; // 0-based line index, inclusive
  end: number; // 0-based line index, exclusive
  lines: string[];
  label: string;
}

function splitReplacement(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return normalized.split("\n");
}

function fail(ir: string, reason: string, details?: string): PatchOutcome {
  return {
    ok: false,
    ir,
    diagnostics: [
      diagnostic("W008", {
        stage: "normalize",
        message: "Incremental patch discarded; a full compilation is required.",
        details: details ? `${reason} ${details}` : reason,
      }),
    ],
  };
}

export function applyIrPatch(currentIr: string, patch: IrUpdate): PatchOutcome {
  if (patch.kind === "full") {
    const validation = validateIrText(patch.ir);
    if (hasErrors(validation.diagnostics)) {
      return { ok: false, ir: patch.ir, diagnostics: validation.diagnostics };
    }
    return { ok: true, ir: patch.ir, diagnostics: validation.diagnostics };
  }

  const module = parseIrModule(currentIr);
  const lines = module.lines;
  const edits: Edit[] = [];

  for (const replacement of patch.replaceFunctions ?? []) {
    const target = module.functions.find((fn) => fn.name === replacement.name);
    if (!target) {
      return fail(currentIr, `Patch replaces unknown function @${replacement.name}.`);
    }
    edits.push({
      start: target.startLine - 1,
      end: target.endLine,
      lines: splitReplacement(replacement.text),
      label: `function @${replacement.name}`,
    });
  }

  for (const replacement of patch.replaceGlobals ?? []) {
    const target = module.globals.find((global) => global.name === replacement.name);
    if (!target) {
      return fail(currentIr, `Patch replaces unknown global @${replacement.name}.`);
    }
    edits.push({
      start: target.startLine - 1,
      end: target.endLine,
      lines: splitReplacement(replacement.text),
      label: `global @${replacement.name}`,
    });
  }

  for (const name of patch.removeGlobals ?? []) {
    const target = module.globals.find((global) => global.name === name);
    if (!target) {
      return fail(currentIr, `Patch removes unknown global @${name}.`);
    }
    edits.push({ start: target.startLine - 1, end: target.endLine, lines: [], label: `remove @${name}` });
  }

  const insertionPoint = (): number => {
    if (module.functions.length > 0) return module.functions[0]!.startLine - 1;
    return lines.length;
  };

  for (const globalText of patch.addGlobals ?? []) {
    const at = insertionPoint();
    edits.push({ start: at, end: at, lines: splitReplacement(globalText), label: "add global" });
  }

  if (patch.replaceDeclarations !== undefined && patch.replaceDeclarations !== null) {
    for (const declaration of module.declarations) {
      edits.push({
        start: declaration.startLine - 1,
        end: declaration.endLine,
        lines: [],
        label: `remove declaration @${declaration.symbol}`,
      });
    }
    const at = insertionPoint();
    edits.push({
      start: at,
      end: at,
      lines: splitReplacement(patch.replaceDeclarations),
      label: "replace declarations",
    });
  }

  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const overlaps = current.start < previous.end || (current.start === previous.start && current.end === previous.end);
    if (overlaps) {
      return fail(currentIr, `Patch edits overlap (${previous.label} and ${current.label}).`);
    }
  }

  const out: string[] = [];
  let cursor = 0;
  for (const edit of sorted) {
    while (cursor < edit.start) {
      out.push(lines[cursor] ?? "");
      cursor++;
    }
    out.push(...edit.lines);
    cursor = Math.max(cursor, edit.end);
  }
  while (cursor < lines.length) {
    out.push(lines[cursor] ?? "");
    cursor++;
  }

  const nextIr = out.join("\n");

  for (const name of patch.removeGlobals ?? []) {
    const stillReferenced = new RegExp(`@(?:"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"|${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b)`).test(
      nextIr,
    );
    if (stillReferenced) {
      return fail(currentIr, `Patch removes @${name}, which the module still references.`);
    }
  }

  for (const replacement of patch.replaceFunctions ?? []) {
    const reparsed = parseIrModule(nextIr);
    if (!reparsed.functions.some((fn) => fn.name === replacement.name)) {
      return fail(currentIr, `Patched text does not define @${replacement.name}.`);
    }
  }

  const validation = validateIrText(nextIr);
  if (hasErrors(validation.diagnostics)) {
    return fail(currentIr, "Patched module failed validation.", validation.diagnostics.map((d) => d.message).join(" "));
  }

  return { ok: true, ir: nextIr, diagnostics: validation.diagnostics };
}
