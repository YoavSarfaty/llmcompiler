import { diagnostic, type Diagnostic } from "../types/diagnostics.ts";
import { LIMITS } from "./limits.ts";
import { analyzeLine } from "./irText.ts";
import { allInstructions, type IrModule } from "./irSpans.ts";
import { utf8ByteLength } from "./sourceRanges.ts";

/**
 * Enforces the supported IR subset (spec §3.4) before LLVM sees the
 * module, so that a policy violation produces a precise diagnostic
 * instead of an opaque verifier error.
 */

interface TokenRule {
  pattern: RegExp;
  label: string;
  code?: string;
}

const FORBIDDEN: TokenRule[] = [
  { pattern: /\basm\b/, label: "inline assembly (`asm`)" },
  { pattern: /\bcallbr\b/, label: "`callbr`" },
  { pattern: /\binvoke\b/, label: "exception handling (`invoke`)" },
  { pattern: /\blandingpad\b/, label: "exception handling (`landingpad`)" },
  { pattern: /\bresume\b/, label: "exception handling (`resume`)" },
  { pattern: /\bcatchswitch\b/, label: "exception handling (`catchswitch`)" },
  { pattern: /\bcatchpad\b/, label: "exception handling (`catchpad`)" },
  { pattern: /\bcleanuppad\b/, label: "exception handling (`cleanuppad`)" },
  { pattern: /\bcleanupret\b/, label: "exception handling (`cleanupret`)" },
  { pattern: /\bthread_local\b/, label: "thread-local storage" },
  { pattern: /\bpersonality\b/, label: "exception personality" },
  { pattern: /\bprefix\b/, label: "`prefix` data layout attribute" },
  { pattern: /\bprologue\b/, label: "`prologue` data layout attribute" },
  { pattern: /\bllvm\.experimental\./, label: "experimental intrinsic" },
  { pattern: /\bllvm\.coro\./, label: "coroutine intrinsic" },
  { pattern: /\bllvm\.stackrestore\b/, label: "`llvm.stackrestore`" },
  { pattern: /\bllvm\.returnaddress\b/, label: "`llvm.returnaddress`" },
  { pattern: /\bllvm\.frameaddress\b/, label: "`llvm.frameaddress`" },
  { pattern: /\bllvm\.eh\./, label: "exception intrinsic" },
  { pattern: /\bi128\b/, label: "`i128`" },
  { pattern: /\bhalf\b/, label: "`half`" },
  { pattern: /\bx86_fp80\b/, label: "`x86_fp80`" },
  { pattern: /\bppc_fp128\b/, label: "`ppc_fp128`" },
  { pattern: /\bfp128\b/, label: "`fp128`" },
];

const STARTUP_SYMBOLS = new Set([
  "_start",
  "__wasm_call_ctors",
  "__wasm_call_dtors",
  "__original_main",
  "__main_void",
  "__libc_start_main",
]);

function irRange(line: number, column: number, length = 1) {
  return { line, column, length };
}

function columnOf(index: number): number {
  return index + 1;
}

export function checkSubset(module: IrModule): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const irBytes = utf8ByteLength(module.text);
  if (irBytes > LIMITS.maxIrBytes) {
    diagnostics.push(
      diagnostic("E014", {
        stage: "conformance",
        message: `Generated IR is ${irBytes} bytes; the limit is ${LIMITS.maxIrBytes}.`,
      }),
    );
  }

  for (const problem of module.structuralErrors) {
    diagnostics.push(
      diagnostic("E018", {
        stage: "parse",
        message: problem.message,
        irRanges: [irRange(problem.line, 1)],
      }),
    );
  }

  for (let index = 0; index < module.lines.length; index++) {
    const raw = module.lines[index] ?? "";
    const analyzed = analyzeLine(raw);
    if (analyzed.trim() === "") continue;
    const lineNumber = index + 1;

    // Typed pointers: `*` has no other meaning in LLVM IR text.
    const starIndex = analyzed.indexOf("*");
    if (starIndex !== -1) {
      diagnostics.push(
        diagnostic("E018", {
          stage: "conformance",
          message: "Typed pointer in generated IR; the supported dialect uses opaque `ptr`.",
          details: `Offending text: ${raw.trim()}`,
          irRanges: [irRange(lineNumber, columnOf(starIndex))],
        }),
      );
    }

    for (const rule of FORBIDDEN) {
      const match = rule.pattern.exec(analyzed);
      if (match) {
        diagnostics.push(
          diagnostic("E018", {
            stage: "conformance",
            message: `Unsupported IR construct: ${rule.label}.`,
            details: `Offending text: ${raw.trim()}`,
            irRanges: [irRange(lineNumber, columnOf(match.index))],
          }),
        );
      }
    }

    const atomicIndex = analyzed.search(/\batomic(rmw)?\b|\bcmpxchg\b|\bfence\b/);
    if (atomicIndex !== -1 && !/\bmonotonic\b/.test(analyzed)) {
      diagnostics.push(
        diagnostic("E018", {
          stage: "conformance",
          message: "Atomic operations must use `monotonic` ordering in ABI v1.",
          irRanges: [irRange(lineNumber, columnOf(atomicIndex))],
        }),
      );
    }

    const syncIndex = analyzed.indexOf("syncscope(");
    if (syncIndex !== -1 && !analyzed.includes('syncscope("singlethread")')) {
      diagnostics.push(
        diagnostic("E018", {
          stage: "conformance",
          message: 'Only `syncscope("singlethread")` is supported in ABI v1.',
          irRanges: [irRange(lineNumber, columnOf(syncIndex))],
        }),
      );
    }
  }

  const mains = module.functions.filter((f) => f.name === "main");
  if (mains.length === 0) {
    diagnostics.push(
      diagnostic("E018", {
        stage: "conformance",
        message: "Module has no `main` definition.",
        details: "ABI v1 requires exactly one `i32 @main()` or `i32 @main(i32, ptr)`.",
      }),
    );
  } else if (mains.length > 1) {
    diagnostics.push(
      diagnostic("E018", {
        stage: "conformance",
        message: "Module defines `main` more than once.",
        irRanges: mains.map((f) => irRange(f.startLine, 1)),
      }),
    );
  }

  for (const fn of module.functions) {
    if (STARTUP_SYMBOLS.has(fn.name)) {
      diagnostics.push(
        diagnostic("E018", {
          stage: "conformance",
          message: `Module defines startup symbol \`${fn.name}\`, which the runtime supplies.`,
          irRanges: [irRange(fn.startLine, 1)],
        }),
      );
    }
  }

  const instructions = allInstructions(module);
  if (instructions.length > 65_536) {
    diagnostics.push(
      diagnostic("E014", {
        stage: "conformance",
        message: `Module has ${instructions.length} instructions; the limit is 65536.`,
      }),
    );
  }
  for (const fn of module.functions) {
    const labels = module.lines
      .slice(fn.startLine, fn.endLine)
      .filter((line) => /^(?:[A-Za-z$._][\w$.-]*|\d+):\s*$/.test(analyzeLine(line).trim())).length;
    if (labels > 1024) {
      diagnostics.push(
        diagnostic("E014", {
          stage: "conformance",
          message: `Function @${fn.name} has ${labels} basic blocks; the limit is 1024.`,
          irRanges: [irRange(fn.startLine, 1)],
        }),
      );
    }
  }

  return diagnostics;
}
