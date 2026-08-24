import { describe, expect, it } from "vitest";
import {
  assertLexicalGraphAligned,
  createCompatibilityMatrix,
  validateCompatibilityConfig,
} from "./runner.mjs";

const LEXICAL_PEER_RANGE = ">=0.45.0 <0.50.0";
const LEXICAL_VERSIONS = ["0.45.0", "0.46.0", "0.47.0", "0.48.0", "0.49.0"];
const lexicalPackageManifest = {
  peerDependencies: {
    "@lexical/clipboard": LEXICAL_PEER_RANGE,
    "@lexical/react": LEXICAL_PEER_RANGE,
    "@lexical/utils": LEXICAL_PEER_RANGE,
    lexical: LEXICAL_PEER_RANGE,
  },
  devDependencies: {
    "@lexical/clipboard": "0.49.0",
    "@lexical/react": "0.49.0",
    "@lexical/utils": "0.49.0",
    lexical: "0.49.0",
  },
};

describe("Lexical compatibility configuration", () => {
  it("keeps the current lane and E2E boundaries in the unit matrix", () => {
    const config = {
      unitVersions: LEXICAL_VERSIONS,
      e2eVersions: ["0.45.0", "0.49.0"],
    };

    expect(
      validateCompatibilityConfig(config, "0.49.0", lexicalPackageManifest),
    ).toBe(config);
    expect(
      createCompatibilityMatrix(
        config,
        "0.49.0",
        undefined,
        lexicalPackageManifest,
      ),
    ).toEqual([
      { version: "0.45.0", current: false, e2e: true },
      { version: "0.46.0", current: false, e2e: false },
      { version: "0.47.0", current: false, e2e: false },
      { version: "0.48.0", current: false, e2e: false },
      { version: "0.49.0", current: true, e2e: true },
    ]);
  });

  it("rejects a gap between supported Lexical minors", () => {
    expect(() =>
      validateCompatibilityConfig(
        {
          unitVersions: ["0.45.0", "0.46.0", "0.48.0", "0.49.0"],
          e2eVersions: ["0.45.0", "0.49.0"],
        },
        "0.49.0",
        lexicalPackageManifest,
      ),
    ).toThrow("unitVersions must include every Lexical minor");
  });

  it("rejects Lexical peer ranges that are not aligned", () => {
    expect(() =>
      validateCompatibilityConfig(
        {
          unitVersions: LEXICAL_VERSIONS,
          e2eVersions: ["0.45.0", "0.49.0"],
        },
        "0.49.0",
        {
          ...lexicalPackageManifest,
          peerDependencies: {
            ...lexicalPackageManifest.peerDependencies,
            lexical: ">=0.46.0 <0.50.0",
          },
        },
      ),
    ).toThrow("Lexical peerDependencies must use one shared range");
  });

  it("rejects a peer range that extends beyond the next current minor", () => {
    expect(() =>
      validateCompatibilityConfig(
        {
          unitVersions: LEXICAL_VERSIONS,
          e2eVersions: ["0.45.0", "0.49.0"],
        },
        "0.49.0",
        {
          ...lexicalPackageManifest,
          peerDependencies: Object.fromEntries(
            Object.keys(lexicalPackageManifest.peerDependencies).map((name) => [
              name,
              ">=0.45.0 <0.51.0",
            ]),
          ),
        },
      ),
    ).toThrow("must end at the exclusive next minor");
  });

  it("requires the exact lower and current versions in the E2E matrix", () => {
    expect(() =>
      validateCompatibilityConfig(
        {
          unitVersions: LEXICAL_VERSIONS,
          e2eVersions: ["0.46.0", "0.48.0"],
        },
        "0.49.0",
        lexicalPackageManifest,
      ),
    ).toThrow("e2eVersions must include the exact lower-bound version");
  });

  it("rejects development Lexical packages that drift", () => {
    expect(() =>
      validateCompatibilityConfig(
        {
          unitVersions: LEXICAL_VERSIONS,
          e2eVersions: ["0.45.0", "0.49.0"],
        },
        "0.49.0",
        {
          ...lexicalPackageManifest,
          devDependencies: {
            ...lexicalPackageManifest.devDependencies,
            "@lexical/utils": "0.48.0",
          },
        },
      ),
    ).toThrow("development Lexical packages must use one exact version");
  });

  it("rejects E2E versions that are absent from the unit matrix", () => {
    expect(() =>
      validateCompatibilityConfig(
        {
          unitVersions: LEXICAL_VERSIONS,
          e2eVersions: ["0.44.0"],
        },
        "0.49.0",
        lexicalPackageManifest,
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
