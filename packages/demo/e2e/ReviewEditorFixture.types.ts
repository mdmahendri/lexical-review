import type { TextReviewType } from "lexical-review";

export type ReviewEditorScenario =
  | "insertion-boundary"
  | "consecutive-delete-start";

export type ReviewSegment = {
  review: TextReviewType;
  text: string;
};

export type NativeCaret = {
  anchorNodeType: "element" | "text";
  offset: number;
  review: TextReviewType;
  segmentIndex: number;
};

export type ReviewEditorFixtureApi = {
  getCaret: (scenario: ReviewEditorScenario) => NativeCaret | null;
  getSegments: (scenario: ReviewEditorScenario) => ReviewSegment[];
  placeCaret: (scenario: ReviewEditorScenario) => void;
};

declare global {
  interface Window {
    __lexicalReviewEditorFixture?: ReviewEditorFixtureApi;
  }
}
