import { describe, expect, it } from "vitest";
import {
  assertE2EReactVersionAllowed,
  assertLexicalGraphAligned,
  assertReactGraphAligned,
  createCompatibilityMatrix,
  createE2ECompatibilityMatrix,
  getCurrentLexicalVersion,
  getCurrentReactVersion,
  validateCompatibilityConfig,
} from "./runner.mjs";

const LEXICAL_PEER_RANGE = ">=0.45.0 <0.50.0";
const LEXICAL_VERSIONS = ["0.45.0", "0.46.0", "0.47.0", "0.48.0", "0.49.0"];
const E2E_REACT_VERSIONS = ["18.3.1"];
const lexicalPackageManifest = {
  peerDependencies: {
    "@lexical/clipboard": LEXICAL_PEER_RANGE,
    "@lexical/react": LEXICAL_PEER_RANGE,
    "@lexical/utils": LEXICAL_PEER_RANGE,
    lexical: LEXICAL_PEER_RANGE,
    react: "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
  },
  devDependencies: {
    "@lexical/clipboard": "0.49.0",
    "@lexical/react": "0.49.0",
    "@lexical/utils": "0.49.0",
    lexical: "0.49.0",
    react: "^19.2.3",
    "react-dom": "^19.2.3",
  },
};
const compatibilityConfig = {
  unitVersions: LEXICAL_VERSIONS,
  e2eVersions: ["0.45.0", "0.49.0"],
  e2eReactVersions: E2E_REACT_VERSIONS,
};

describe("Lexical compatibility configuration", () => {
  it("keeps the current lane and E2E boundaries in the unit matrix", () => {
    expect(
      validateCompatibilityConfig(
        compatibilityConfig,
        "0.49.0",
        lexicalPackageManifest,
      ),
    ).toBe(compatibilityConfig);
    expect(
      createCompatibilityMatrix(
        compatibilityConfig,
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

  it("creates browser lanes without a full React-by-Lexical matrix", () => {
    expect(
      createE2ECompatibilityMatrix(
        compatibilityConfig,
        "0.49.0",
        undefined,
        lexicalPackageManifest,
      ),
    ).toEqual([
      {
        lexicalVersion: "0.45.0",
        reactVersion: "19.2.3",
        project: "all",
      },
      {
        lexicalVersion: "0.49.0",
        reactVersion: "19.2.3",
        project: "all",
      },
      {
        lexicalVersion: "0.45.0",
        reactVersion: "18.3.1",
        project: "chromium",
      },
      {
        lexicalVersion: "0.49.0",
        reactVersion: "18.3.1",
        project: "chromium",
      },
    ]);
  });

  it("derives one current React version from aligned development dependencies", () => {
    expect(getCurrentReactVersion(lexicalPackageManifest)).toBe("19.2.3");
  });

  it("restricts E2E React versions to configured lanes", () => {
    expect(() =>
      assertE2EReactVersionAllowed(
        "19.2.3",
        compatibilityConfig,
        lexicalPackageManifest,
      ),
    ).not.toThrow();
    expect(() =>
      assertE2EReactVersionAllowed(
        "18.3.1",
        compatibilityConfig,
        lexicalPackageManifest,
      ),
    ).not.toThrow();
    expect(() =>
      assertE2EReactVersionAllowed(
        "17.0.2",
        compatibilityConfig,
        lexicalPackageManifest,
      ),
    ).toThrow("19.2.3, 18.3.1");
    expect(() =>
      assertE2EReactVersionAllowed(
        "19.2.4",
        compatibilityConfig,
        lexicalPackageManifest,
      ),
    ).toThrow("19.2.3, 18.3.1");
  });

  it("accepts semantically equivalent React peer ranges", () => {
    expect(
      validateCompatibilityConfig(compatibilityConfig, "0.49.0", {
        ...lexicalPackageManifest,
        peerDependencies: {
          ...lexicalPackageManifest.peerDependencies,
          react: ">=18.0.0 <20.0.0",
          "react-dom": ">=18.0.0 <20.0.0",
        },
      }),
    ).toBe(compatibilityConfig);
  });

  it("rejects empty React peer ranges", () => {
    expect(() =>
      validateCompatibilityConfig(compatibilityConfig, "0.49.0", {
        ...lexicalPackageManifest,
        peerDependencies: {
          ...lexicalPackageManifest.peerDependencies,
          react: "",
          "react-dom": "",
        },
      }),
    ).toThrow("React peerDependencies must use a valid semver range");
  });

  it("rejects development versions that are not valid SemVer", () => {
    expect(() =>
      getCurrentLexicalVersion({
        ...lexicalPackageManifest,
        devDependencies: {
          ...lexicalPackageManifest.devDependencies,
          "@lexical/clipboard": "0.49.00",
          "@lexical/react": "0.49.00",
          "@lexical/utils": "0.49.00",
          lexical: "0.49.00",
        },
      }),
    ).toThrow("development Lexical packages must use exact versions");

    expect(() =>
      getCurrentReactVersion({
        ...lexicalPackageManifest,
        devDependencies: {
          ...lexicalPackageManifest.devDependencies,
          react: "^019.2.3",
          "react-dom": "^019.2.3",
        },
      }),
    ).toThrow("must use an exact or caret version");
  });

  it("keeps the Lexical peer range policy explicit", () => {
    expect(() =>
      validateCompatibilityConfig(compatibilityConfig, "0.49.0", {
        ...lexicalPackageManifest,
        peerDependencies: Object.fromEntries(
          Object.entries(lexicalPackageManifest.peerDependencies).map(
            ([name, version]) => [
              name,
              name.startsWith("@lexical/") || name === "lexical"
                ? "^0.45.0"
                : version,
            ],
          ),
        ),
      }),
    ).toThrow("Lexical peerDependencies must use one shared range");
  });

  it("uses a requested exact version as a temporary E2E lane", () => {
    expect(
      createE2ECompatibilityMatrix(
        compatibilityConfig,
        "0.49.0",
        "0.48.1",
        lexicalPackageManifest,
      ),
    ).toEqual([
      {
        lexicalVersion: "0.48.1",
        reactVersion: "19.2.3",
        project: "all",
      },
      {
        lexicalVersion: "0.48.1",
        reactVersion: "18.3.1",
        project: "chromium",
      },
    ]);
  });

  it("rejects a gap between supported Lexical minors", () => {
    expect(() =>
      validateCompatibilityConfig(
        {
          unitVersions: ["0.45.0", "0.46.0", "0.48.0", "0.49.0"],
          e2eVersions: ["0.45.0", "0.49.0"],
          e2eReactVersions: E2E_REACT_VERSIONS,
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
          e2eReactVersions: E2E_REACT_VERSIONS,
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
          e2eReactVersions: E2E_REACT_VERSIONS,
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
          e2eReactVersions: E2E_REACT_VERSIONS,
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
          e2eReactVersions: E2E_REACT_VERSIONS,
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
          e2eReactVersions: E2E_REACT_VERSIONS,
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

describe("React package graph verification", () => {
  it("accepts one exact React and ReactDOM version", () => {
    expect(
      assertReactGraphAligned(
        {
          dependencies: {
            react: { from: "react", version: "18.3.1" },
            "react-dom": {
              from: "react-dom",
              version: "18.3.1",
              dependencies: {
                react: { from: "react", version: "18.3.1" },
              },
            },
          },
        },
        "18.3.1",
      ),
    ).toEqual([
      { name: "react-dom", version: "18.3.1" },
      { name: "react", version: "18.3.1" },
    ]);
  });

  it("rejects React and ReactDOM version drift", () => {
    expect(() =>
      assertReactGraphAligned(
        {
          dependencies: {
            react: { from: "react", version: "18.3.1" },
            "react-dom": { from: "react-dom", version: "19.2.3" },
          },
        },
        "18.3.1",
      ),
    ).toThrow("react-dom@19.2.3");
  });
});
