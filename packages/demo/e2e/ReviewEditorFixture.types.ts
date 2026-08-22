import type { TextReviewType } from "lexical-review";

export type ReviewEditorScenario =
  | "insertion-boundary"
  | "consecutive-delete-start"
  | "composition"
  | "composition-selection";

export type ReviewSegment = {
  review: TextReviewType;
  text: string;
};

export type ReviewTextRange = {
  start: number;
  end: number;
};

export type NativeCaret = {
  anchorNodeType: "element" | "text";
  offset: number;
  review: TextReviewType;
  segmentIndex: number;
};

export type ReviewMarkup = {
  format: string | null;
  marker: string | null;
  text: string;
};

export type ReviewEditorFixtureApi = {
  compose: (
    scenario: ReviewEditorScenario,
    text: string,
    selection?: ReviewTextRange,
  ) => void;
  getCaret: (scenario: ReviewEditorScenario) => NativeCaret | null;
  getMarkup: (scenario: ReviewEditorScenario) => ReviewMarkup;
  getSegments: (scenario: ReviewEditorScenario) => ReviewSegment[];
  placeCaret: (scenario: ReviewEditorScenario) => void;
};

declare global {
  interface Window {
    __lexicalReviewEditorFixture?: ReviewEditorFixtureApi;
  }
}
