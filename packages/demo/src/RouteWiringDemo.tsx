import { useCallback, useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  FORMAT_TEXT_COMMAND,
} from "lexical";
import {
  $deleteReviewText,
  $insertReviewText,
  $listReviewProposals,
  $toggleReviewFormatting,
  openReviewSession,
  type ReviewSession,
} from "lexical-review";
import {
  RESOLVE_REVIEW_PROPOSALS_COMMAND,
  ReviewSessionPlugin,
  type ReviewIntentOutcome,
} from "lexical-review/client";

function describeOutcome(outcome: ReviewIntentOutcome): string {
  switch (outcome.status) {
    case "changed":
      return "changed — the review state gained, extended, or settled a proposal";
    case "unchanged":
      return "unchanged — nothing to do (for example, empty input)";
    case "refused":
      return `refused / ${outcome.code} — no mutation, selection preserved: ${outcome.message}`;
    case "failed":
      return `failed / ${outcome.error.code}: ${outcome.error.message}`;
  }
}

export default function RouteWiringDemo() {
  const [editor] = useLexicalComposerContext();
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [outcome, setOutcome] = useState<ReviewIntentOutcome | null>(null);
  const [outcomeCount, setOutcomeCount] = useState(0);
  const factoryCounter = useRef(0);
  const factory = useCallback(
    () => `route-wiring-${++factoryCounter.current}`,
    [],
  );

  const handleOutcome = useCallback((next: ReviewIntentOutcome) => {
    setOutcome(next);
    setOutcomeCount((count) => count + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("AB")));
      },
      { discrete: true },
    );
    const input = editor.getEditorState().toJSON();
    const opened = openReviewSession(editor, {
      root: {
        ...input.root,
        $: { "lexical-review": { version: 3, extensions: [] } },
      },
    });
    if (opened.status !== "valid") throw new Error("Invalid route-wiring demo");
    if (!cancelled) setSession(opened.value);
    return () => {
      cancelled = true;
    };
  }, [editor, factory]);

  const resetBaseline = useCallback(() => {
    factoryCounter.current = 0;
    setOutcome(null);
    setOutcomeCount(0);
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("AB")));
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
  }, [editor]);

  const selectAcceptedTarget = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
      },
      { discrete: true },
    );
  }, [editor]);

  const insertProgrammatic = useCallback(() => {
    editor.update(
      () => {
        const result = $insertReviewText("x", {
          proposalIdFactory: factory,
        });
        handleOutcome(result);
      },
      { discrete: true },
    );
  }, [editor, factory, handleOutcome]);

  const formatProgrammatic = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(0, 1);
        handleOutcome(
          $toggleReviewFormatting("bold", { proposalIdFactory: factory }),
        );
      },
      { discrete: true },
    );
  }, [editor, factory, handleOutcome]);

  const focusEditor = useCallback(() => {
    editor.getRootElement()?.focus();
  }, [editor]);

  const continueInProposal = useCallback(() => {
    editor.update(
      () => {
        const nodes = $getRoot().getAllTextNodes();
        const insertion = nodes.find((node) => {
          const parent = node.getParent();
          return parent !== null && parent.getType() === "review-insertion";
        });
        (insertion ?? nodes[0])?.selectEnd();
        handleOutcome($insertReviewText("!", { proposalIdFactory: factory }));
      },
      { discrete: true },
    );
  }, [editor, factory, handleOutcome]);

  const attemptAcceptedSideDeletion = useCallback(() => {
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(1, 1);
        handleOutcome($deleteReviewText(false, {}));
      },
      { discrete: true },
    );
  }, [editor, handleOutcome]);

  const toggleBold = useCallback(() => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
  }, [editor]);

  const resolveViaCommand = useCallback(
    (action: "accept" | "reject" | "remove") => {
      const ids = editor.getEditorState().read(() => $listReviewProposals());
      if (ids.length === 0) {
        handleOutcome({
          code: "unsupported-target",
          message: "No pending proposal to resolve.",
          status: "refused",
        });
        return;
      }
      editor.update(() => {
        editor.dispatchCommand(RESOLVE_REVIEW_PROPOSALS_COMMAND, {
          action,
          ids,
        });
      });
    },
    [editor, handleOutcome],
  );

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4 overflow-x-hidden">
      <p data-testid="capability-label" className="text-sm text-gray-600">
        Capability demo — non-normative, not a host UI pattern
      </p>

      <section
        aria-labelledby="route-wiring-guide-heading"
        className="flex min-w-0 flex-col gap-4"
      >
        <h2
          id="route-wiring-guide-heading"
          className="font-semibold text-gray-800"
        >
          Guide — prove each route reaches the same intent
        </h2>

        <section
          aria-labelledby="route-pair-a-heading"
          className="min-w-0 rounded border p-3"
        >
          <h3 id="route-pair-a-heading" className="font-semibold text-gray-800">
            Route pair A — Insert x: keyboard or programmatic, same intent
          </h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-gray-600">
            <li>
              Start from{" "}
              <button
                type="button"
                data-testid="reset-baseline"
                className="rounded border px-2 py-0.5 text-sm"
                onClick={resetBaseline}
              >
                Reset AB
              </button>{" "}
              then{" "}
              <button
                type="button"
                data-testid="select-target"
                className="rounded border px-2 py-0.5 text-sm"
                onClick={selectAcceptedTarget}
              >
                Select after A
              </button>
              .
            </li>
            <li>
              Either focus the editor and type x, or press{" "}
              <button
                type="button"
                data-testid="insert-programmatic"
                className="rounded border px-2 py-0.5 text-sm"
                onClick={insertProgrammatic}
              >
                Insert x (programmatic == keyboard)
              </button>
              . Both report <em>changed</em> and produce the same proposal.
            </li>
            <li>
              Keyboard path needs no host code beyond session registration — use{" "}
              <button
                type="button"
                data-testid="focus-editor"
                className="rounded border px-2 py-0.5 text-sm"
                onClick={focusEditor}
              >
                Focus editor
              </button>{" "}
              then type.
            </li>
          </ol>
        </section>

        <section
          aria-labelledby="route-pair-b-heading"
          className="min-w-0 rounded border p-3"
        >
          <h3 id="route-pair-b-heading" className="font-semibold text-gray-800">
            Route pair B — Bold A: toolbar or programmatic, same intent
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            The toolbar&apos;s genuine jobs are formatting and resolution —
            never text insertion. Both buttons below bold the accepted “A” and
            report <em>changed</em> with the same formatting proposal.
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              data-testid="bold-toggle"
              className="rounded border px-2 py-1 text-sm"
              onClick={toggleBold}
            >
              Bold toggle (toolbar)
            </button>
            <button
              type="button"
              data-testid="bold-programmatic"
              className="rounded border px-2 py-1 text-sm"
              onClick={formatProgrammatic}
            >
              Bold (programmatic == toolbar)
            </button>
          </div>
        </section>

        <section
          aria-labelledby="pinned-examples-heading"
          className="min-w-0 rounded border p-3"
        >
          <h3
            id="pinned-examples-heading"
            className="font-semibold text-gray-800"
          >
            Pinned examples — proposal-local editing vs accepted-side refusal
          </h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-gray-600">
            <li>
              With an insertion present,{" "}
              <button
                type="button"
                data-testid="continue-proposal"
                className="rounded border px-2 py-0.5 text-sm"
                onClick={continueInProposal}
              >
                Continue in proposal (!)
              </button>{" "}
              types inside the proposal: same identity, <em>changed</em>.
            </li>
            <li>
              <button
                type="button"
                data-testid="refuse-deletion"
                className="rounded border px-2 py-0.5 text-sm"
                onClick={attemptAcceptedSideDeletion}
              >
                Accepted-side Delete (refuses)
              </button>{" "}
              deletes forward from accepted text into the insertion:{" "}
              <em>refused / deletion-target-unavailable</em>, document and
              selection untouched. Same adjacency, opposite side — opposite
              behavior.
            </li>
          </ol>
        </section>

        <section
          aria-labelledby="settle-heading"
          className="min-w-0 rounded border p-3"
        >
          <h3 id="settle-heading" className="font-semibold text-gray-800">
            Settle the proposal (toolbar resolve)
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            One call carries exactly one action and reports through the same
            outcome pane — no reordering, no focus or scroll side effects.
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              data-testid="accept-proposal"
              className="rounded border px-2 py-1 text-sm"
              onClick={() => resolveViaCommand("accept")}
            >
              Accept
            </button>
            <button
              type="button"
              data-testid="reject-proposal"
              className="rounded border px-2 py-1 text-sm"
              onClick={() => resolveViaCommand("reject")}
            >
              Reject
            </button>
            <button
              type="button"
              data-testid="remove-proposal"
              className="rounded border px-2 py-1 text-sm"
              onClick={() => resolveViaCommand("remove")}
            >
              Remove
            </button>
          </div>
        </section>
      </section>

      <section
        aria-labelledby="route-wiring-editor-heading"
        className="min-w-0"
      >
        <h2
          id="route-wiring-editor-heading"
          className="mb-1 font-semibold text-gray-800"
        >
          Editable review projection
        </h2>
        <div className="min-h-24 min-w-0 rounded border p-2">
          <ContentEditable
            data-testid="route-wiring-editor"
            className="min-w-0 outline-none"
          />
        </div>
      </section>

      <section
        aria-labelledby="route-wiring-outcome-heading"
        className="min-w-0"
      >
        <h2
          id="route-wiring-outcome-heading"
          className="mb-1 font-semibold text-gray-800"
        >
          Outcome
        </h2>
        <div
          data-testid="outcome-pane"
          className="min-w-0 rounded border bg-gray-50 p-2 text-sm"
        >
          <p>
            Latest outcome:{" "}
            {outcome === null
              ? "none yet — run the guide above"
              : describeOutcome(outcome)}
          </p>
          <p>Reported outcomes this baseline: {outcomeCount}</p>
          <p data-testid="failed-slot" className="mt-1 text-gray-600">
            failed is a typed slot (status failed with error code/message); #76
            never triggers it live inside an update.
          </p>
        </div>
      </section>
      {session === null ? null : (
        <ReviewSessionPlugin
          session={session}
          proposalIdFactory={factory}
          onOutcome={handleOutcome}
        />
      )}
    </div>
  );
}
