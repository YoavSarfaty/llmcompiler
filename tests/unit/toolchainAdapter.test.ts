import { describe, expect, it } from "vitest";
import { ToolchainUnavailableError, UnavailableToolchain } from "../../src/toolchain/ToolchainAdapter.ts";

const toolchain = new UnavailableToolchain();

describe("unavailable toolchain adapter", () => {
  it("fails initialization explicitly instead of claiming a toolchain exists", async () => {
    await expect(toolchain.init()).rejects.toBeInstanceOf(ToolchainUnavailableError);
  });

  it("does not claim parse or verification succeeded", async () => {
    const parsed = await toolchain.parse("not LLVM");
    const verified = await toolchain.verify("not LLVM");

    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.code).toBe("E012");
    expect(verified.ok).toBe(false);
    expect(verified.diagnostics[0]?.code).toBe("E012");
  });

  it("never returns empty bytes as a successful executable", async () => {
    const result = await toolchain.compile("anything", { optimize: false });

    expect(result.ok).toBe(false);
    expect(result.wasm).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("E012");
  });
});
