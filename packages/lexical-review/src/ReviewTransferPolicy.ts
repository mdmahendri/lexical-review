/**
 * Transfer-route policy for the client review session (#65/#66).
 *
 * Cut, copy, paste, and drop gestures own their single outcome at
 * CUT/COPY/DROP/PASTE_COMMAND, the only routes carrying clipboard data. The
 * other halves of the same physical gestures report nothing and must not
 * mutate: the deletion half of a cut or drag, the beforeinput paste bridge
 * (clipboard data is reliably readable only in the paste event), and the
 * drop-insertion half. Untrusted insertions that reach CONTROLLED insertion
 * outside those halves are refused instead of suppressed.
 *
 * This module classifies those follow-up inputs and names the owning route.
 * Claiming, preventDefault, and outcome reporting stay in the adapter.
 */
export type TransferInputRoute = "beforeinput" | "controlled" | "removal";

export type TransferRouteOwner = "cut" | "paste" | "drop";

export type TransferDecision =
  | Readonly<{ kind: "unrelated" }>
  | Readonly<{ kind: "suppress"; owner: TransferRouteOwner }>
  | Readonly<{ kind: "refuse" }>;

export function classifyTransferInput(
  route: TransferInputRoute,
  event: InputEvent,
): TransferDecision {
  switch (route) {
    case "beforeinput":
      if (event.inputType === "deleteByCut")
        return { kind: "suppress", owner: "cut" };
      if (event.inputType === "deleteByDrag")
        return { kind: "suppress", owner: "drop" };
      if (
        event.inputType === "insertFromPaste" ||
        event.inputType === "insertFromPasteAsQuotation"
      )
        return { kind: "suppress", owner: "paste" };
      return { kind: "unrelated" };
    case "removal":
      if (event.inputType === "deleteByCut")
        return { kind: "suppress", owner: "cut" };
      if (event.inputType === "deleteByDrag")
        return { kind: "suppress", owner: "drop" };
      return { kind: "unrelated" };
    case "controlled":
      if (event.inputType === "insertFromDrop")
        return { kind: "suppress", owner: "drop" };
      if (event.dataTransfer != null || event.inputType === "insertFromYank")
        return { kind: "refuse" };
      return { kind: "unrelated" };
  }
}
