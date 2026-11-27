export class AssetIntegrityError extends Error {
  constructor(
    readonly expectedHash: string,
    readonly actualHash: string,
  ) {
    super(`Asset SHA-256 mismatch: expected ${expectedHash}, received ${actualHash}.`);
    this.name = "AssetIntegrityError";
  }
}

export class AssetFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetFetchError";
  }
}

/** Fetch a static artifact without credentials and return it only after SHA-256 verification. */
export async function fetchVerifiedAsset(
  url: string | URL,
  expectedHash: string,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (!/^[\da-f]{64}$/i.test(expectedHash)) {
    throw new AssetFetchError("Expected SHA-256 must be exactly 64 hexadecimal characters.");
  }

  const response = await fetcher(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    throw new AssetFetchError(`Asset request failed with HTTP ${response.status}.`);
  }
  if (!globalThis.crypto?.subtle) {
    throw new AssetFetchError("Web Crypto SHA-256 is unavailable; refusing to load the asset.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const normalizedExpectedHash = expectedHash.toLowerCase();
  if (actualHash !== normalizedExpectedHash) {
    throw new AssetIntegrityError(normalizedExpectedHash, actualHash);
  }
  return bytes;
}
