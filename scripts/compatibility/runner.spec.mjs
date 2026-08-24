import { describe, expect, it } from "vitest";
import {
  assertLexicalGraphAligned,
  createCompatibilityMatrix,
  validateCompatibilityConfig,
} from "./runner.mjs";

describe("Lexical compatibility configuration", () => {
  it("keeps the current lane and E2E selections in the unit matrix", () => {
    const config = {
      unitVersions: ["0.48.0", "0.49.0"],
      e2eVersions: ["0.48.0", "0.49.0"],
    };

    expect(validateCompatibilityConfig(config, "0.49.0")).toBe(config);
    expect(createCompatibilityMatrix(config, "0.49.0")).toEqual([
      { version: "0.48.0", current: false, e2e: true },
      { version: "0.49.0", current: true, e2e: true },
    ]);
  });

  it("rejects E2E versions that are absent from the unit matrix", () => {
    expect(() =>
      validateCompatibilityConfig(
        { unitVersions: ["0.49.0"], e2eVersions: ["0.48.0"] },
        "0.49.0",
      ),
    ).toThrow("e2eVersions must be a subset of unitVersions");
  });
});

describe("Lexical package graph verification", () => {
  it("accepts a recursive graph with one exact Lexical version", () => {
    expect(
      assertLexicalGraphAligned(
        [
          {
            name: "lexical-review",
            dependencies: {
              lexical: {
                from: "lexical",
                version: "0.49.0",
                dependencies: {
                  "@lexical/internal": {
                    from: "@lexical/internal",
                    version: "0.49.0",
                  },
                },
              },
            },
          },
        ],
        "0.49.0",
      ),
    ).toEqual([
      { name: "@lexical/internal", version: "0.49.0" },
      { name: "lexical", version: "0.49.0" },
    ]);
  });

  it("rejects a mixed Lexical package graph", () => {
    expect(() =>
      assertLexicalGraphAligned(
        {
          dependencies: {
            lexical: { from: "lexical", version: "0.49.0" },
            "@lexical/utils": { from: "@lexical/utils", version: "0.48.0" },
          },
        },
        "0.49.0",
      ),
    ).toThrow("@lexical/utils@0.48.0");
  });

  it("recognizes package names from dependency-map keys", () => {
    expect(
      assertLexicalGraphAligned(
        {
          dependencies: {
            lexical: { version: "0.49.0" },
            "@lexical/utils": { version: "0.49.0" },
          },
        },
        "0.49.0",
      ),
    ).toEqual([
      { name: "@lexical/utils", version: "0.49.0" },
      { name: "lexical", version: "0.49.0" },
    ]);
  });
});
