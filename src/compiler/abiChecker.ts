import { diagnostic, type Diagnostic } from "../types/diagnostics.ts";
import { analyzeLine } from "./irText.ts";
import type { IrModule } from "./irSpans.ts";
import { describeSignature, SIGNATURES_BY_SYMBOL, type CanonicalSignature } from "./abi.ts";

/**
 * Checks the module against ABI v1 (spec §3.3, §3.5).
 *
 * This is a deterministic text pass. It catches the failure that model
 * output hits most often: a plausible-looking call to a runtime function
 * whose signature does not match the sysroot, which would otherwise
 * surface as a confusing link error.
 */

interface ParsedSignature {
  kind: "declare" | "define";
  symbol: string;
  returns: string;
  params: string[];
  line: number;
}

const DECLARATION = /^(declare|define)\s+(.+?)\s+@(?:"([^"]+)"|([A-Za-z$._][\w$.-]*))\s*\((.*)$/;

/** Split a parameter list on top-level commas, respecting nested brackets. */
export function splitParams(paramsText: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of paramsText) {
    if (ch === "[" || ch === "{" || ch === "<" || ch === "(") depth++;
    else if (ch === "]" || ch === "}" || ch === ">" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      params.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") params.push(current);
  return params.map((p) => p.trim()).filter((p) => p !== "");
}

/** Reduce a parameter to its type, dropping attributes and the local name. */
export function normalizeParam(param: string): string {
  let text = param.trim();
  // Drop a trailing local name: `ptr %p` -> `ptr`.
  text = text.replace(/\s+%(?:"[^"]+"|[A-Za-z$._][\w$.-]*|\d+)$/, "");
  // Drop common parameter attributes wherever they appear.
  text = text
    .replace(/\b(?:noundef|nonnull|readonly|readnone|writeonly|nocapture|noalias|noescape|signext|zeroext|inreg|swiftself|swifterror|immarg|returned|align|dereferenceable|dereferenceable_or_null)\b(?:\s+\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "...") return "...";
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    return end === -1 ? text : text.slice(0, end + 1).replace(/\s+/g, " ");
  }
  if (text.startsWith("{")) {
    const end = text.lastIndexOf("}");
    return end === -1 ? text : text.slice(0, end + 1).replace(/\s+/g, " ");
  }
  return text.split(/\s+/)[0] ?? text;
}

function parseSignatures(module: IrModule): ParsedSignature[] {
  const parsed: ParsedSignature[] = [];
  const consider = (text: string, line: number) => {
    const match = DECLARATION.exec(text.trim());
    if (!match) return;
    const kind = match[1] === "declare" ? "declare" : "define";
    const returns = match[2]!.trim();
    const symbol = match[3] ?? match[4] ?? "";
    const rest = match[5] ?? "";
    const close = rest.lastIndexOf(")");
    const paramsText = close === -1 ? rest : rest.slice(0, close);
    parsed.push({
      kind,
      symbol,
      returns,
      params: splitParams(paramsText).map(normalizeParam),
      line,
    });
  };

  for (const declaration of module.declarations) {
    consider(declaration.text, declaration.startLine);
  }
  for (const fn of module.functions) {
    consider(fn.header, fn.startLine);
  }
  return parsed;
}

function signatureMatches(parsed: ParsedSignature, canonical: CanonicalSignature): boolean {
  if (parsed.returns !== canonical.returns) return false;
  if (parsed.params.length !== canonical.params.length) return false;
  return parsed.params.every((param, index) => param === canonical.params[index]);
}

export function checkAbi(module: IrModule): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const parsed = parseSignatures(module);

  for (const signature of parsed) {
    const canonical = SIGNATURES_BY_SYMBOL.get(signature.symbol);
    if (!canonical) continue;

    if (signature.kind === "define") {
      diagnostics.push(
        diagnostic("E017", {
          stage: "conformance",
          message: `Module defines \`@${signature.symbol}\`, which ABI v1 resolves from the sysroot.`,
          details: `Declare it instead: ${describeSignature(canonical)}`,
          irRanges: [{ line: signature.line, column: 1 }],
        }),
      );
      continue;
    }

    if (!signatureMatches(signature, canonical)) {
      diagnostics.push(
        diagnostic("E017", {
          stage: "conformance",
          message: `Declaration of \`@${signature.symbol}\` does not match ABI v1.`,
          details: `Expected: ${describeSignature(canonical)}. Found: ${signature.returns} @${signature.symbol}(${signature.params.join(", ")}). Sizes are 32-bit on wasm32.`,
          irRanges: [{ line: signature.line, column: 1 }],
        }),
      );
    }
  }

  const mains = parsed.filter((signature) => signature.kind === "define" && signature.symbol === "main");
  for (const main of mains) {
    const okReturn = main.returns === "i32";
    const okParams =
      main.params.length === 0 || (main.params.length === 2 && main.params[0] === "i32" && main.params[1] === "ptr");
    if (!okReturn || !okParams) {
      diagnostics.push(
        diagnostic("E017", {
          stage: "conformance",
          message: "`main` must be `i32 @main()` or `i32 @main(i32, ptr)`.",
          details: `Found: ${main.returns} @main(${main.params.join(", ")})`,
          irRanges: [{ line: main.line, column: 1 }],
        }),
      );
    }
  }

  const declared = new Set(parsed.map((signature) => signature.symbol));
  const defined = new Set(parsed.filter((signature) => signature.kind === "define").map((signature) => signature.symbol));

  for (let index = 0; index < module.lines.length; index++) {
    const analyzed = analyzeLine(module.lines[index] ?? "");
    const callPattern = /\bcall\b[^@]*@(?:"([^"]+)"|([A-Za-z$._][\w$.-]*))\s*\(/g;
    for (const match of analyzed.matchAll(callPattern)) {
      const symbol = match[1] ?? match[2] ?? "";
      if (!SIGNATURES_BY_SYMBOL.has(symbol)) continue;
      if (declared.has(symbol) || defined.has(symbol)) continue;
      diagnostics.push(
        diagnostic("E017", {
          stage: "conformance",
          message: `Call to \`@${symbol}\` without a declaration.`,
          details: `Add: ${describeSignature(SIGNATURES_BY_SYMBOL.get(symbol)!)}`,
          irRanges: [{ line: index + 1, column: 1 }],
        }),
      );
    }
  }

  return diagnostics;
}
