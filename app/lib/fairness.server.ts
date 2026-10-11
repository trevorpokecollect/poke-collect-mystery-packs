import { createHash, randomBytes, randomInt } from "node:crypto";

/** Fisher–Yates shuffle driven by Node's CSPRNG. Returns a new array. */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Commitment to the shuffled pack order. Published at launch; once the series
 * closes the salt and ordered list are published so anyone can recompute it:
 *   sha256(salt + ":" + cardVariantIds.join(","))
 */
export function commitmentHash(salt: string, orderedCardIds: readonly string[]): string {
  return createHash("sha256")
    .update(`${salt}:${orderedCardIds.join(",")}`)
    .digest("hex");
}
