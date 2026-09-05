export function isValidProposalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    })
  );
}

export function assertValidProposalId(value: unknown): asserts value is string {
  if (!isValidProposalId(value)) {
    throw new Error(
      "Proposal identity must be nonempty text without surrounding whitespace or control characters.",
    );
  }
}

let generatedProposalCounter = 0;

export function createProposalId(): string {
  generatedProposalCounter += 1;
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === "function") {
    return `review-${cryptoObject.randomUUID()}`;
  }
  return `review-${Date.now().toString(36)}-${generatedProposalCounter.toString(36)}`;
}
