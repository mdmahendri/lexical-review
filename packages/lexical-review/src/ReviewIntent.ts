export type ReviewIntentRefusalCode =
  | "ambiguous-boundary"
  | "deletion-target-unavailable"
  | "invalid-proposal-id"
  | "invalid-structural-target"
  | "unsafe-proposal-intersection"
  | "unsupported-formatting"
  | "unsupported-input"
  | "unsupported-proposal-edit"
  | "unsupported-structure"
  | "unsupported-target"
  | "unsupported-transfer";

export type ReviewIntentRefusal = Readonly<{
  code: ReviewIntentRefusalCode;
  message: string;
  status: "refused";
}>;

export type ReviewIntentError = Readonly<{
  cause: unknown;
  code: string;
  message: string;
}>;

export type ReviewIntentOutcome<T = void> =
  | Readonly<{ status: "changed"; value: T }>
  | Readonly<{ status: "unchanged"; value: T }>
  | ReviewIntentRefusal
  | Readonly<{ error: ReviewIntentError; status: "failed" }>;

export type Preparation<T> =
  Readonly<{ status: "ready"; value: T }> | ReviewIntentRefusal;

export function refusal(
  code: ReviewIntentRefusalCode,
  message: string,
): ReviewIntentRefusal {
  return { code, message, status: "refused" };
}

export function changed(): ReviewIntentOutcome {
  return { status: "changed", value: undefined };
}

export function unchanged(): ReviewIntentOutcome {
  return { status: "unchanged", value: undefined };
}
