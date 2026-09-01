import { useEffect, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  COMPOSITION_END_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  TextNode,
} from "lexical";
import {
  $createLegacyReviewTextNode as $createReviewTextNode,
  $isLegacyReviewTextNode as $isReviewTextNode,
  LegacyReviewTextNode as ReviewTextNode,
  type LegacyTextReviewType as TextReviewType,
  openLegacyReviewSession as openReviewSession,
  type LegacyReviewSession as ReviewSession,
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

const sessionState = {
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Alpha beta gamma",
            type: "text",
            version: 1,
          },
        ],
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        type: "paragraph",
        version: 1,
      },
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
    $: {
      "lexical-review": {
        proposals: [],
        version: 3,
      },
    },
  },
};

const sessionInitialConfig = {
  ...initialConfig,
  namespace: "review-session-editor-e2e",
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

function ReviewSessionEditor() {
  const [editor] = useLexicalComposerContext();
  const [session, setSession] = useState<ReviewSession | null>(null);

  useEffect(() => {
    const opened = openReviewSession(editor, sessionState, {
      identityFactory: () => "browser-deletion",
    });
    if (opened.status !== "valid") {
      throw new Error("Could not open the deletion review session fixture.");
    }
    setSession(opened.value);
  }, [editor]);

  useEffect(() => {
    if (session === null) {
      return;
    }

    const getParagraph = () => {
      const paragraph = $getRoot().getFirstChild();
      if (!$isElementNode(paragraph)) {
        throw new Error("Could not find the deletion session paragraph.");
      }
      return paragraph;
    };

    const getTextNodes = () =>
      getParagraph()
        .getChildren()
        .filter((node): node is TextNode => $isTextNode(node));

    const getTextDOM = (key: string): Text => {
      const textDOM = getReviewTextDOM(editor.getElementByKey(key));
      if (textDOM === null) {
        throw new Error("Could not find the deletion session text node.");
      }
      return textDOM;
    };

    const setSelection = (
      startKey: string,
      startOffset: number,
      endKey: string,
      endOffset: number,
    ) => {
      const startDOM = getTextDOM(startKey);
      const endDOM = getTextDOM(endKey);
      const selection = startDOM.ownerDocument.getSelection();
      if (selection === null) {
        throw new Error("Could not select the deletion session text.");
      }
      const range = startDOM.ownerDocument.createRange();
      range.setStart(startDOM, startOffset);
      range.setEnd(endDOM, endOffset);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.getRootElement()?.focus();
    };

    const getPointAtOffset = (offset: number) => {
      const nodes = getTextNodes();
      const lastNode = nodes.at(-1);
      if (lastNode === undefined) {
        throw new Error("Could not find the deletion session text.");
      }
      let remaining = Math.max(0, offset);
      for (const node of nodes) {
        const length = node.getTextContentSize();
        if (remaining <= length) {
          return { node, offset: remaining };
        }
        remaining -= length;
      }
      return { node: lastNode, offset: lastNode.getTextContentSize() };
    };

    const getSegments = () =>
      editor.getEditorState().read(() =>
        getParagraph()
          .getChildren()
          .map((node) => {
            if (!$isTextNode(node)) {
              throw new Error("The deletion session contains a non-text node.");
            }
            return {
              review: $isReviewTextNode(node)
                ? getReviewType(node)
                : "original",
              text: node.getTextContent(),
            };
          }),
      );

    const placeCaret = (offset: number) => {
      const point = editor.getEditorState().read(() => {
        const result = getPointAtOffset(offset);
        return { key: result.node.getKey(), offset: result.offset };
      });
      setSelection(point.key, point.offset, point.key, point.offset);
    };

    const placeSegmentCaret = (segmentIndex: number, offset: number) => {
      const point = editor.getEditorState().read(() => {
        const node = getParagraph().getChildAtIndex(segmentIndex);
        if (!$isTextNode(node)) {
          throw new Error("Could not find the deletion session segment.");
        }
        return {
          key: node.getKey(),
          offset: Math.max(0, Math.min(offset, node.getTextContentSize())),
        };
      });
      setSelection(point.key, point.offset, point.key, point.offset);
    };

    const selectSegmentRange = (
      startSegmentIndex: number,
      startOffset: number,
      endSegmentIndex: number,
      endOffset: number,
    ) => {
      const points = editor.getEditorState().read(() => {
        const startNode = getParagraph().getChildAtIndex(startSegmentIndex);
        const endNode = getParagraph().getChildAtIndex(endSegmentIndex);
        if (!$isTextNode(startNode) || !$isTextNode(endNode)) {
          throw new Error("Could not find the deletion session selection.");
        }
        return {
          endKey: endNode.getKey(),
          startKey: startNode.getKey(),
        };
      });
      setSelection(points.startKey, startOffset, points.endKey, endOffset);
    };

    const getCaret = (): NativeCaret | null => {
      return editor.getEditorState().read(() => {
        const selection = window.getSelection();
        if (selection === null || selection.anchorNode === null) {
          return null;
        }
        const anchorNode = selection.anchorNode;
        const nodes = getTextNodes();
        const segmentIndex = nodes.findIndex((node) =>
          editor.getElementByKey(node.getKey())?.contains(anchorNode),
        );
        const segment = nodes[segmentIndex];
        if (segmentIndex < 0 || segment === undefined) {
          return null;
        }
        return {
          anchorNodeType:
            anchorNode.nodeType === Node.TEXT_NODE ? "text" : "element",
          offset: selection.anchorOffset,
          review: $isReviewTextNode(segment)
            ? getReviewType(segment)
            : "original",
          segmentIndex,
        };
      });
    };

    const insertText = (text: string) => {
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, text);
    };

    const dispatchBeforeInput = (inputType: string) => {
      const root = editor.getRootElement();
      if (root === null) {
        throw new Error("Could not find the deletion session editor.");
      }
      const event = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType,
      });
      root.dispatchEvent(event);
      return event.defaultPrevented;
    };

    const api = {
      dispatchBeforeInput,
      getCaret,
      getSegments,
      insertText,
      placeCaret,
      placeSegmentCaret,
      selectSegmentRange,
    };
    window.__lexicalReviewSessionEditorFixture = api;
    return () => {
      if (window.__lexicalReviewSessionEditorFixture === api) {
        delete window.__lexicalReviewSessionEditorFixture;
      }
    };
  }, [editor, session]);

  return (
    <div className="h-screen p-8">
      <ReviewTextPlugin
        contentEditable={
          <ContentEditable
            data-testid="review-session-editor"
            className="outline-none"
          />
        }
        session={session ?? undefined}
      />
    </div>
  );
}

export default function ReviewEditorFixture() {
  return (
    <>
      <LexicalComposer initialConfig={initialConfig}>
        <ReviewEditor />
      </LexicalComposer>
      <LexicalComposer initialConfig={sessionInitialConfig}>
        <ReviewSessionEditor />
      </LexicalComposer>
    </>
  );
}
