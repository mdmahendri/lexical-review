import { useEffect } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import {
  $getRoot,
  $isElementNode,
  COMPOSITION_END_COMMAND,
  TextNode,
} from "lexical";
import {
  $createLegacyReviewTextNode as $createReviewTextNode,
  $isLegacyReviewTextNode as $isReviewTextNode,
  LegacyReviewTextNode as ReviewTextNode,
  type LegacyTextReviewType as TextReviewType,
} from "lexical-review";
import { LegacyReviewTextPlugin as ReviewTextPlugin } from "lexical-review/client";
import type {
  NativeCaret,
  ReviewEditorFixtureApi,
  ReviewEditorScenario,
  ReviewSegment,
  ReviewTextRange,
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
      },
      {
        "children": [
          {
            "detail": 0,
            "format": 2,
            "mode": "normal",
            "style": "",
            "text": "composed",
            "type": "review",
            "review": 2,
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

function getReviewTextDOM(element: HTMLElement | null): Text | null {
  let contentDOM = element;

  while (contentDOM?.firstElementChild instanceof HTMLElement) {
    contentDOM = contentDOM.firstElementChild;
  }

  return contentDOM?.firstChild instanceof Text ? contentDOM.firstChild : null;
}

function ReviewEditor() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditorState(editor.parseEditorState(JSON.parse(fixtureState)));

    const getParagraphIndex = (scenario: ReviewEditorScenario): number => {
      if (scenario === "insertion-boundary") {
        return 1;
      }
      if (scenario === "composition") {
        return 2;
      }
      return 0;
    };

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

    const getMarkup = (scenario: ReviewEditorScenario) => {
      const nodeKey = editor
        .getEditorState()
        .read(() => getScenarioNode(scenario).getKey());
      const marker = editor.getElementByKey(nodeKey);
      const format = marker?.firstElementChild;

      return {
        format: format?.tagName ?? null,
        marker: marker?.tagName ?? null,
        text: marker?.textContent ?? "",
      };
    };

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

    const getScenarioTextDOM = (scenario: ReviewEditorScenario): Text => {
      const nodeKey = editor
        .getEditorState()
        .read(() => getScenarioNode(scenario).getKey());
      const textDOM = getReviewTextDOM(editor.getElementByKey(nodeKey));

      if (textDOM == null) {
        throw new Error("Could not find the review fixture text node.");
      }

      return textDOM;
    };

    const setSelection = (
      scenario: ReviewEditorScenario,
      start: number,
      end: number,
    ): void => {
      const textDOM = getScenarioTextDOM(scenario);
      const selection = textDOM.ownerDocument.getSelection();

      if (selection == null) {
        throw new Error("Could not select the review fixture text.");
      }

      const range = textDOM.ownerDocument.createRange();
      range.setStart(textDOM, start);
      range.setEnd(textDOM, end);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.getRootElement()?.focus();
    };

    const placeCaret = (scenario: ReviewEditorScenario): void => {
      const offset = editor.getEditorState().read(() => {
        const node = getScenarioNode(scenario);

        return scenario === "insertion-boundary" || scenario === "composition"
          ? node.getTextContentSize()
          : 0;
      });
      setSelection(scenario, offset, offset);
    };

    const compose = (
      scenario: ReviewEditorScenario,
      text: string,
      selectedRange?: ReviewTextRange,
    ): void => {
      if (selectedRange == null) {
        placeCaret(scenario);
      } else {
        setSelection(scenario, selectedRange.start, selectedRange.end);
      }

      const rootElement = editor.getRootElement();
      const selection = rootElement?.ownerDocument.getSelection();

      if (rootElement == null || selection == null) {
        throw new Error("Could not prepare the review composition.");
      }

      rootElement.dispatchEvent(
        new CompositionEvent("compositionstart", {
          bubbles: true,
          data: "",
        }),
      );

      // Lexical can replace the selected DOM text node while preparing a
      // non-collapsed composition, so read the composition target afterwards.
      const textDOM =
        selection.anchorNode instanceof Text ? selection.anchorNode : null;
      if (textDOM == null) {
        throw new Error("Could not find the composition text node.");
      }

      const currentText = textDOM.nodeValue ?? "";
      const suffix = currentText.endsWith("\u200b")
        ? "\u200b"
        : currentText.endsWith("\u00a0")
          ? "\u00a0"
          : "";
      const composingText =
        suffix === "" ? currentText : currentText.slice(0, -suffix.length);
      const composedText = `${composingText}${text}${suffix}`;
      textDOM.nodeValue = composedText;
      const range = document.createRange();
      range.setStart(textDOM, composedText.length - 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      const inputEvent = new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertCompositionText",
      });
      Object.defineProperty(inputEvent, "isComposing", {
        configurable: true,
        value: true,
      });

      rootElement.dispatchEvent(inputEvent);

      // Lexical defers native compositionend handling differently across
      // browsers. Commit through the command directly so the fixture does
      // not stop in a browser-specific intermediate composition state.
      editor.dispatchCommand(
        COMPOSITION_END_COMMAND,
        new CompositionEvent("compositionend", {
          bubbles: true,
          cancelable: true,
          data: text,
        }),
      );
    };

    const api: ReviewEditorFixtureApi = {
      compose,
      getCaret,
      getMarkup,
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
