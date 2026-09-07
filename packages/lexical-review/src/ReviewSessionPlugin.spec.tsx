/**
 * Plugin parity coverage for the `copyProjection` forwarding fix: the React
 * `ReviewSessionPlugin` must honor the same clipboard-projection option as
 * direct `registerReviewSession`, instead of silently dropping it.
 *
 * Both cases dispatch `COPY_COMMAND` through the composer-owned editor. The
 * insertion-only fixture discriminates the modes: `accepted-state` refuses
 * with an empty projection, while the default yields all-accepted content.
 */
import { useEffect, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, COPY_COMMAND, type LexicalEditor } from "lexical";
import {
  openReviewSession,
  ReviewDeletionNode,
  ReviewInsertionNode,
} from "./index";
import type { ReviewSession } from "./ReviewSession";
import { ReviewSessionPlugin } from "./ReviewSessionPlugin";
import type {
  ReviewCopyProjectionMode,
  ReviewIntentOutcome,
} from "./registerReviewSession";
import {
  paragraph,
  reviewDocument,
  reviewNode,
  text,
} from "./ReviewDocument.test-fixtures";

function insertion(id: string, value: string) {
  return reviewNode("review-insertion", id, [text(value)]);
}

function mockClipboard() {
  const store = new Map<string, string>();
  const setData = vi.fn((type: string, data: string) => {
    store.set(type, data);
  });
  const event = {
    preventDefault: vi.fn(),
    clipboardData: {
      setData,
      getData: (type: string) => store.get(type) ?? "",
    },
  } as unknown as ClipboardEvent;
  return { event, setData, store };
}

function PluginHarness({
  copyProjection,
  outcomes,
  onEditor,
}: {
  copyProjection?: ReviewCopyProjectionMode;
  outcomes: ReviewIntentOutcome[];
  onEditor: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [session, setSession] = useState<ReviewSession | null>(null);
  useEffect(() => {
    onEditor(editor);
    const opened = openReviewSession(
      editor,
      reviewDocument([paragraph([insertion("ins-a", "X")])]),
    );
    if (opened.status !== "valid") {
      throw new Error("Expected the review document to open.");
    }
    setSession(opened.value);
  }, [editor, onEditor]);
  if (session === null) return null;
  return (
    <ReviewSessionPlugin
      session={session}
      copyProjection={copyProjection}
      onOutcome={(outcome) => {
        outcomes.push(outcome);
      }}
    />
  );
}

async function renderPlugin(copyProjection?: ReviewCopyProjectionMode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const reactRoot: Root = createRoot(container);
  const outcomes: ReviewIntentOutcome[] = [];
  let editor: LexicalEditor | null = null;
  await act(async () => {
    reactRoot.render(
      <LexicalComposer
        initialConfig={{
          namespace: "review-session-plugin",
          nodes: [ReviewInsertionNode, ReviewDeletionNode],
          onError: (error) => {
            throw error;
          },
          theme: {},
        }}
      >
        <ContentEditable />
        <PluginHarness
          copyProjection={copyProjection}
          outcomes={outcomes}
          onEditor={(ready) => {
            editor = ready;
          }}
        />
      </LexicalComposer>,
    );
  });
  if (editor === null) throw new Error("Expected the composer editor.");
  const ready: LexicalEditor = editor;
  ready.update(
    () => {
      const [node] = $getRoot().getAllTextNodes();
      node!.select(0, 1);
    },
    { discrete: true },
  );
  await Promise.resolve();
  return { container, reactRoot, editor: ready, outcomes };
}

async function teardown(container: HTMLElement, reactRoot: Root) {
  await act(async () => {
    reactRoot.unmount();
  });
  container.remove();
}

describe("ReviewSessionPlugin copyProjection parity", () => {
  it("refuses an insertion-only copy under accepted-state like direct registration", async () => {
    const { container, reactRoot, editor, outcomes } =
      await renderPlugin("accepted-state");
    try {
      const clipboard = mockClipboard();
      expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
      await Promise.resolve();

      expect(outcomes).toMatchObject([
        { code: "empty-projection", status: "refused" },
      ]);
      expect(clipboard.setData).not.toHaveBeenCalled();
    } finally {
      await teardown(container, reactRoot);
    }
  });

  it("copies insertion content by default like direct registration", async () => {
    const { container, reactRoot, editor, outcomes } = await renderPlugin();
    try {
      const clipboard = mockClipboard();
      expect(editor.dispatchCommand(COPY_COMMAND, clipboard.event)).toBe(true);
      await Promise.resolve();

      expect(outcomes).toMatchObject([
        { status: "changed", value: { mode: "all-accepted" } },
      ]);
      expect(clipboard.store.get("text/plain")).toBe("X");
    } finally {
      await teardown(container, reactRoot);
    }
  });
});
