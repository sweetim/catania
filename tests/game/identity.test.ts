import { afterEach, describe, expect, mock, test } from "bun:test";
import { generateIdentifier } from "../../src/identity";

const nativeDescriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
const entropyDescriptor = Object.getOwnPropertyDescriptor(crypto, "getRandomValues");
afterEach(() => {
  if (nativeDescriptor) Object.defineProperty(crypto, "randomUUID", nativeDescriptor);
  else Reflect.deleteProperty(crypto, "randomUUID");
  if (entropyDescriptor) Object.defineProperty(crypto, "getRandomValues", entropyDescriptor);
  else Reflect.deleteProperty(crypto, "getRandomValues");
});

test("identifier generation uses native randomUUID when available", () => {
  const expected = "01234567-89ab-4cde-8f01-23456789abcd";
  const native = mock(() => expected);
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: native });
  expect(generateIdentifier()).toBe(expected);
  expect(native).toHaveBeenCalledTimes(1);
});

describe("identifier generation without randomUUID", () => {
  test.each([
    [0x00, "00000000-0000-4000-8000-000000000000"],
    [0xff, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
  ] as const)("sets UUID version and variant bits for entropy byte %s", (value, expected) => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    const entropy = mock((array: Uint8Array) => {
      expect(array).toHaveLength(16);
      array.fill(value);
      return array;
    });
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: entropy });
    expect(generateIdentifier()).toBe(expected);
    expect(entropy).toHaveBeenCalledTimes(1);
  });

  test("produces distinct UUIDs from cryptographic randomness", () => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    const identifiers = Array.from({ length: 1000 }, () => generateIdentifier());
    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const identifier of identifiers) {
      expect(identifier).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  test("propagates unavailable cryptographic entropy rather than using insecure randomness", () => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    const entropy = mock(() => {
      throw new Error("Cryptographic entropy unavailable");
    });
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: entropy });
    expect(generateIdentifier).toThrow("Cryptographic entropy unavailable");
  });
});
