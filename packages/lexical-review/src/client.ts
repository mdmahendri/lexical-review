"use client";

export { ReviewTextPlugin as LegacyReviewTextPlugin } from "./LexicalReviewTextPlugin";
export { ReviewSessionPlugin } from "./ReviewSessionPlugin";
export { registerReviewText as registerLegacyReviewText } from "./registerReviewText";
export {
  registerReviewSession,
  type ReviewSessionRegistrationOptions,
} from "./registerReviewSession";
export type {
  ReviewIntentError,
  ReviewIntentOutcome,
  ReviewIntentRefusal,
  ReviewIntentRefusalCode,
  ReviewProposalIdFactory,
} from "./registerReviewSession";
export type { ProposalResolutionAction } from "./ReviewResolution";

export {
  INSERT_REVIEW_FRAGMENT_COMMAND,
  RESOLVE_REVIEW_PROPOSALS_COMMAND,
  type ReviewResolutionRoutePayload,
} from "./registerReviewSession";
export type {
  ReviewPasteNormalization,
  ReviewPasteOutcome,
  ReviewPasteRun,
} from "./ReviewPaste";
export type {
  ReviewMultilinePasteNormalization,
  ReviewMultilinePasteOutcome,
} from "./ReviewMultilinePaste";
