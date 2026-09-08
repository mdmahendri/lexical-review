import { describe, expect, it } from "vitest";
import { deriveEvidenceStatus } from "./evidenceStatus";

describe("deriveEvidenceStatus", () => {
  it("starts not generated", () => {
    expect(
      deriveEvidenceStatus({
        isComposing: false,
        hasEvidence: false,
        isStale: false,
        hasGenerationFailure: false,
      }),
    ).toBe("not-generated");
  });

  it("is current when evidence matches the document", () => {
    expect(
      deriveEvidenceStatus({
        isComposing: false,
        hasEvidence: true,
        isStale: false,
        hasGenerationFailure: false,
      }),
    ).toBe("current");
  });

  it("is stale after a document change", () => {
    expect(
      deriveEvidenceStatus({
        isComposing: false,
        hasEvidence: true,
        isStale: true,
        hasGenerationFailure: false,
      }),
    ).toBe("stale");
  });

  it("is unavailable during composition", () => {
    expect(
      deriveEvidenceStatus({
        isComposing: true,
        hasEvidence: true,
        isStale: false,
        hasGenerationFailure: false,
      }),
    ).toBe("unavailable");
  });

  it("is unavailable on generation failure even with matching evidence", () => {
    expect(
      deriveEvidenceStatus({
        isComposing: false,
        hasEvidence: true,
        isStale: false,
        hasGenerationFailure: true,
      }),
    ).toBe("unavailable");
  });

  it("is unavailable on initial generation failure, not not-generated", () => {
    expect(
      deriveEvidenceStatus({
        isComposing: false,
        hasEvidence: false,
        isStale: false,
        hasGenerationFailure: true,
      }),
    ).toBe("unavailable");
  });

  it("prefers composition over a stale failure flag", () => {
    expect(
      deriveEvidenceStatus({
        isComposing: true,
        hasEvidence: true,
        isStale: true,
        hasGenerationFailure: true,
      }),
    ).toBe("unavailable");
  });
});
