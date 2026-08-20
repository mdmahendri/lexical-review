import { useEffect } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { $getRoot, $isElementNode, TextNode } from "lexical";
import {
  $createReviewTextNode,
  $isReviewTextNode,
  ReviewTextNode,
  type TextReviewType,
} from "lexical-review";
import { ReviewTextPlugin } from "lexical-review/client";
import type {
  NativeCaret,
  ReviewEditorFixtureApi,
  ReviewEditorScenario,
  ReviewSegment,
} from "./ReviewEditorFixture.types";

const fixtureState = `
{
  "root": {
    "children": [
      {
        "children": [
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "abcdef",
            "type": "review",
            "review": 1,
            "version": 1
          }
        ],
        "direction": "ltr",
        "format": "",
        "indent": 0,
        "type": "paragraph",
        "version": 1,
        "textFormat": 0,
        "textStyle": ""
      },
      {
        "children": [
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "before",
            "type": "review",
            "review": 1,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "inserted",
            "type": "review",
            "review": 2,
            "version": 1
          },
          {
            "detail": 0,
            "format": 0,
            "mode": "normal",
            "style": "",
            "text": "after",
            "type": "review",
            "review": 1,
            "version": 1
          }
        ],
        "direction": "ltr",
        "format": "",
        "indent": 0,
        "type": "paragraph",
        "version": 1,
        "textFormat": 0,
        "textStyle": ""
      }
    ],
    "direction": "ltr",
    "format": "",
    "indent": 0,
    "type": "root",
    "version": 1
  }
}
`;

const initialConfig = {
  namespace: "review-editor-e2e",
  onError(error: Error) {
    throw error;
  },
  nodes: [
    ReviewTextNode,
    {
      replace: TextNode,
      with: (node: TextNode) =>
        $createReviewTextNode(node.getTextContent(), "original"),
      withKlass: ReviewTextNode,
    },
  ],
  theme: {
    ins: "review-insertion",
    del: "review-deletion",
  },
};

function getReviewType(node: ReviewTextNode): TextReviewType {
  for (const reviewType of ["original", "insertion", "deletion"] as const) {
    if (node.hasReviewType(reviewType)) {
      return reviewType;
    }
  }

  throw new Error("Could not determine the review type.");
}

function ReviewEditor() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditorState(editor.parseEditorState(JSON.parse(fixtureState)));

    const getParagraphIndex = (scenario: ReviewEditorScenario): number =>
      scenario === "insertion-boundary" ? 1 : 0;

    const getScenarioParagraph = (scenario: ReviewEditorScenario) => {
      const paragraph = $getRoot().getChildAtIndex(getParagraphIndex(scenario));

      if (paragraph == null || !$isElementNode(paragraph)) {
        throw new Error("Could not find the review fixture paragraph.");
      }

      return paragraph;
    };

    const getScenarioNode = (scenario: ReviewEditorScenario) => {
      const node = getScenarioParagraph(scenario).getFirstChild();

      if (!$isReviewTextNode(node)) {
        throw new Error("Could not find the review fixture scenario.");
      }

      return node;
    };

    const getSegments = (scenario: ReviewEditorScenario): ReviewSegment[] =>
      editor.getEditorState().read(() =>
        getScenarioParagraph(scenario)
          .getChildren()
          .map((node) => {
            if (!$isReviewTextNode(node)) {
              throw new Error("The review fixture contains a non-review node.");
            }

            return {
              review: getReviewType(node),
              text: node.getTextContent(),
            };
          }),
      );

    const getCaret = (scenario: ReviewEditorScenario): NativeCaret | null => {
      const selection = window.getSelection();

      if (selection == null || selection.anchorNode == null) {
        return null;
      }
      const anchorNode = selection.anchorNode;

      return editor.getEditorState().read(() => {
        const segments = getScenarioParagraph(scenario).getChildren();
        const segmentIndex = segments.findIndex((node) => {
          const element = editor.getElementByKey(node.getKey());
          return element?.contains(anchorNode) === true;
        });
        const segment = segments[segmentIndex];

        if (segmentIndex < 0 || !$isReviewTextNode(segment)) {
          return null;
        }

        return {
          anchorNodeType:
            anchorNode.nodeType === Node.TEXT_NODE ? "text" : "element",
          offset: selection.anchorOffset,
          review: getReviewType(segment),
          segmentIndex,
        };
      });
    };

    const placeCaret = (scenario: ReviewEditorScenario): void => {
      const { key, offset } = editor.getEditorState().read(() => {
        const node = getScenarioNode(scenario);

        return {
          key: node.getKey(),
          offset:
            scenario === "insertion-boundary" ? node.getTextContentSize() : 0,
        };
      });
      const element = editor.getElementByKey(key);
      const textNode = element?.firstChild;
      const selection = element?.ownerDocument.getSelection();

      if (element == null || !(textNode instanceof Text) || selection == null) {
        throw new Error("Could not place the review fixture caret.");
      }

      const range = element.ownerDocument.createRange();
      range.setStart(textNode, offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.getRootElement()?.focus();
    };

    const api: ReviewEditorFixtureApi = {
      getCaret,
      getSegments,
      placeCaret,
    };
    window.__lexicalReviewEditorFixture = api;

    return () => {
      if (window.__lexicalReviewEditorFixture === api) {
        delete window.__lexicalReviewEditorFixture;
      }
    };
  }, [editor]);

  return (
    <div className="h-screen p-8">
      <ReviewTextPlugin
        contentEditable={
          <ContentEditable
            data-testid="review-editor"
            className="outline-none"
          />
        }
      />
      <HistoryPlugin />
    </div>
  );
}

export default function ReviewEditorFixture() {
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ReviewEditor />
    </LexicalComposer>
  );
}
