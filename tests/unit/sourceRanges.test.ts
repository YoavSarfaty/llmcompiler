import { describe, expect, it } from "vitest";
import {
  checkSourceLimits,
  countLines,
  isValidSourceRange,
  lineColumnToOffset,
  offsetToLineColumn,
  utf8ByteLength,
} from "../../src/compiler/sourceRanges.ts";
import { LIMITS } from "../../src/compiler/limits.ts";

describe("source ranges", () => {
  it("counts UTF-8 bytes, not UTF-16 units", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });

  it("counts lines including a trailing newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(3);
  });

  it("maps offsets to 1-based line and column", () => {
    const text = "ab\ncde";
    expect(offsetToLineColumn(text, 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineColumn(text, 2)).toEqual({ line: 1, column: 3 });
    expect(offsetToLineColumn(text, 3)).toEqual({ line: 2, column: 1 });
    expect(offsetToLineColumn(text, 6)).toEqual({ line: 2, column: 4 });
  });

  it("round-trips line and column to offset", () => {
    const text = "ab\ncde";
    expect(lineColumnToOffset(text, 2, 4)).toBe(6);
    expect(lineColumnToOffset(text, 9, 1)).toBe(text.length);
  });

  it("rejects ranges that split a surrogate pair", () => {
    const text = "a😀b"; // a, high, low, b
    expect(isValidSourceRange(text, { from: 1, to: 2 })).toBe(false);
    expect(isValidSourceRange(text, { from: 2, to: 3 })).toBe(false);
    expect(isValidSourceRange(text, { from: 1, to: 3 })).toBe(true);
    expect(isValidSourceRange(text, { from: 0, to: 4 })).toBe(true);
  });

  it("rejects inverted and out-of-bounds ranges", () => {
    const text = "abc";
    expect(isValidSourceRange(text, { from: 2, to: 1 })).toBe(false);
    expect(isValidSourceRange(text, { from: 0, to: 4 })).toBe(false);
    expect(isValidSourceRange(text, { from: -1, to: 2 })).toBe(false);
  });

  it("reports the source-size limit with E014", () => {
    const oversized = "x".repeat(LIMITS.maxSourceBytes + 1);
    const diagnostics = checkSourceLimits(oversized);
    expect(diagnostics.some((d) => d.code === "E014")).toBe(true);
  });

  it("reports a leading BOM as a warning without changing offsets", () => {
    const diagnostics = checkSourceLimits("\uFEFFx = 1");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("W005");
    expect(diagnostics[0]!.severity).toBe("warning");
  });
});
