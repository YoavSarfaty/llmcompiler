/**
 * ABI v1 runtime surface (spec §3.5).
 *
 * This module is the single source of truth: the prompt prelude and the
 * ABI checker are both generated from it, so they cannot drift apart.
 *
 * Sizes are ILP32: `size_t` and `long` are 32-bit, so `malloc`, `strlen`
 * and `strtol` use `i32` while `strtoll` uses `i64`.
 */

export interface CanonicalSignature {
  symbol: string;
  returns: string;
  params: string[];
}

export const RUNTIME_SIGNATURES: readonly CanonicalSignature[] = [
  { symbol: "malloc", returns: "ptr", params: ["i32"] },
  { symbol: "calloc", returns: "ptr", params: ["i32", "i32"] },
  { symbol: "realloc", returns: "ptr", params: ["ptr", "i32"] },
  { symbol: "free", returns: "void", params: ["ptr"] },

  { symbol: "memcpy", returns: "ptr", params: ["ptr", "ptr", "i32"] },
  { symbol: "memmove", returns: "ptr", params: ["ptr", "ptr", "i32"] },
  { symbol: "memset", returns: "ptr", params: ["ptr", "i32", "i32"] },

  { symbol: "strlen", returns: "i32", params: ["ptr"] },
  { symbol: "strcmp", returns: "i32", params: ["ptr", "ptr"] },
  { symbol: "strncmp", returns: "i32", params: ["ptr", "ptr", "i32"] },
  { symbol: "strcpy", returns: "ptr", params: ["ptr", "ptr"] },
  { symbol: "strncpy", returns: "ptr", params: ["ptr", "ptr", "i32"] },
  { symbol: "strcat", returns: "ptr", params: ["ptr", "ptr"] },
  { symbol: "strchr", returns: "ptr", params: ["ptr", "i32"] },

  { symbol: "printf", returns: "i32", params: ["ptr", "..."] },
  { symbol: "fprintf", returns: "i32", params: ["ptr", "ptr", "..."] },
  { symbol: "snprintf", returns: "i32", params: ["ptr", "i32", "ptr", "..."] },
  { symbol: "puts", returns: "i32", params: ["ptr"] },
  { symbol: "putchar", returns: "i32", params: ["i32"] },
  { symbol: "getchar", returns: "i32", params: [] },
  { symbol: "scanf", returns: "i32", params: ["ptr", "..."] },
  { symbol: "fgets", returns: "ptr", params: ["ptr", "i32", "ptr"] },

  { symbol: "atoi", returns: "i32", params: ["ptr"] },
  { symbol: "strtol", returns: "i32", params: ["ptr", "ptr", "i32"] },
  { symbol: "strtoll", returns: "i64", params: ["ptr", "ptr", "i32"] },
  { symbol: "strtod", returns: "double", params: ["ptr", "ptr"] },

  { symbol: "exit", returns: "void", params: ["i32"] },
  { symbol: "abort", returns: "void", params: [] },

  { symbol: "sqrt", returns: "double", params: ["double"] },
  { symbol: "fabs", returns: "double", params: ["double"] },
  { symbol: "pow", returns: "double", params: ["double", "double"] },
  { symbol: "floor", returns: "double", params: ["double"] },
  { symbol: "ceil", returns: "double", params: ["double"] },
  { symbol: "fmod", returns: "double", params: ["double", "double"] },
  { symbol: "sin", returns: "double", params: ["double"] },
  { symbol: "cos", returns: "double", params: ["double"] },
  { symbol: "exp", returns: "double", params: ["double"] },
  { symbol: "log", returns: "double", params: ["double"] },
];

export const CANONICAL_GLOBALS: readonly string[] = ["stdin", "stdout", "stderr"];

export const SIGNATURES_BY_SYMBOL: ReadonlyMap<string, CanonicalSignature> = new Map(
  RUNTIME_SIGNATURES.map((signature) => [signature.symbol, signature]),
);

/** The declaration block injected into the prompt and used for checking. */
export function runtimeDeclarationBlock(): string {
  const lines = RUNTIME_SIGNATURES.map(
    (signature) => `declare ${signature.returns} @${signature.symbol}(${signature.params.join(", ")})`,
  );
  lines.push("");
  for (const name of CANONICAL_GLOBALS) {
    lines.push(`@${name} = external global ptr`);
  }
  return lines.join("\n");
}

export function describeSignature(signature: CanonicalSignature): string {
  return `${signature.returns} @${signature.symbol}(${signature.params.join(", ")})`;
}
