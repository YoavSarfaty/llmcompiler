import { describe, expect, it } from "vitest";
import {
  AssetFetchError,
  AssetIntegrityError,
  fetchVerifiedAsset,
} from "../../src/toolchain/verifiedAsset.ts";

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("verified static assets", () => {
  it("returns bytes only when the pinned SHA-256 matches", async () => {
    const bytes = new TextEncoder().encode("immutable toolchain artifact");
    const expectedHash = await sha256(bytes);
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
      requestInit = init;
      return new Response(bytes, { status: 200 });
    };

    const result = await fetchVerifiedAsset("https://assets.example.test/compiler.wasm", expectedHash, fetcher);

    expect(Array.from(result)).toEqual(Array.from(bytes));
    expect(requestInit).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  it("rejects a hash mismatch without returning asset bytes", async () => {
    const fetcher: typeof fetch = async () => new Response("untrusted", { status: 200 });

    await expect(fetchVerifiedAsset("https://assets.example.test/compiler.wasm", "0".repeat(64), fetcher))
      .rejects.toBeInstanceOf(AssetIntegrityError);
  });

  it("rejects invalid hashes and failed HTTP responses", async () => {
    let fetched = false;
    const fetcher: typeof fetch = async () => {
      fetched = true;
      return new Response(null, { status: 503 });
    };

    await expect(fetchVerifiedAsset("https://assets.example.test/model.bin", "not-a-hash", fetcher))
      .rejects.toBeInstanceOf(AssetFetchError);
    expect(fetched).toBe(false);
    await expect(fetchVerifiedAsset("https://assets.example.test/model.bin", "a".repeat(64), fetcher))
      .rejects.toThrow("HTTP 503");
  });
});
