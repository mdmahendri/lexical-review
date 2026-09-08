import {
  $createParagraphNode,
  $createTextNode,
  $getEditor,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type ParagraphNode,
  type PointType,
  type TextNode,
} from "lexical";
import {
  $createReviewFragmentNode,
  $isReviewFragmentNode,
  isRootParagraph,
  ReviewFragmentNode,
  $createReviewInsertionNode,
  ReviewInsertionNode,
} from "./ReviewNodes";
import {
  $createReviewBoundaryNode,
  $isReviewBoundaryNode,
  ReviewBoundaryNode,
} from "./ReviewBoundaryNode";
import type { ReviewExtensionEnvelope } from "./ReviewExtensionEnvelope";
import {
  prepareProposalId,
  type ReviewAuthoringOptions,
} from "./ReviewAuthoring";
import {
  changed,
  unchanged,
  refusal,
  type Preparation,
  type ReviewIntentOutcome,
} from "./ReviewIntent";
import {
  fragmentAtPoint,
  inspectFragmentSelection,
  inspectReviewTarget,
  nextCharacterOffset,
  offsetInGroup,
  previousCharacterOffset,
  type FragmentSelection,
} from "./ReviewTargeting";
import {
  $getReviewInputFormat,
  $setReviewInputFormat,
} from "./ReviewInputFormatting";
import { validateStructuralState } from "./ReviewStructure";
import {
  isSupportedFormat,
  type ReviewFormatRun,
} from "./ReviewFormattingState";
import {
  collectProposalNodes,
  inspectCollectedFragmentGroup,
  inspectFragmentGroup,
  type CollectedProposalNodes,
} from "./ReviewProposalCollection";

export type ReviewFragmentParagraph = Readonly<{
  runs: readonly ReviewFormatRun[];
  emptyFormat?: number;
}>;
export type ReviewFragment = readonly ReviewFragmentParagraph[];
export type ReviewFragmentProposal = Readonly<{
  proposalId: string;
  kind: "fragment";
  paragraphs: ReviewFragment;
}>;

type Group = { wrappers: ReviewFragmentNode[]; paragraphs: ParagraphNode[] };
export function inspectFragment(proposalId: string): Preparation<Group> {
  return inspectFragmentGroup(proposalId);
}
function payload(group: Group): ReviewFragment {
  return group.wrappers.map((node) => ({
    emptyFormat: node.getEmptyFormat(),
    runs: node.getChildren<TextNode>().map((text) => ({
      text: text.getTextContent(),
      format: text.getFormat(),
    })),
  }));
}
export function inspectFragmentProposal(
  proposalId: string,
): ReviewIntentOutcome<ReviewFragmentProposal> {
  return inspectCollectedFragmentProposal(
    collectProposalNodes(proposalId),
    proposalId,
  );
}

/**
 * Fragment-proposal inspection read-only over one shared observation.
 * Group success translates to `unchanged` here; callers must not treat
 * group `ready` and proposal `unchanged` as interchangeable outcomes.
 */
export function inspectCollectedFragmentProposal(
  collected: CollectedProposalNodes,
  proposalId: string,
): ReviewIntentOutcome<ReviewFragmentProposal> {
  const group = inspectCollectedFragmentGroup(collected);
  return group.status === "ready"
    ? {
        status: "unchanged",
        value: {
          proposalId,
          kind: "fragment",
          paragraphs: payload(group.value),
        },
      }
    : group;
}

// Offsets are ephemeral positions in the current fragment payload, never live authority.
type Unit = { text: string; format: number };
function units(fragment: ReviewFragment): Unit[] {
  return fragment.flatMap((p, i) => [
    ...(i ? [{ text: "\n", format: p.emptyFormat ?? 0 }] : []),
    ...p.runs.flatMap((run) =>
      Array.from(run.text, (text) => ({ text, format: run.format })),
    ),
  ]);
}
function fromUnits(source: readonly Unit[], format: number): ReviewFragment {
  const result: { runs: ReviewFormatRun[]; emptyFormat: number }[] = [
    { runs: [], emptyFormat: format },
  ];
  for (const unit of source) {
    if (unit.text === "\n") {
      result.push({ runs: [], emptyFormat: unit.format });
      continue;
    }
    const runs = result.at(-1)!.runs;
    const last = runs.at(-1);
    if (last?.format === unit.format)
      runs[runs.length - 1] = {
        text: last.text + unit.text,
        format: unit.format,
      };
    else runs.push({ ...unit });
  }
  return result;
}
function selectOffset(
  wrappers: readonly ReviewFragmentNode[],
  offset: number,
  point?: PointType,
): void {
  for (const wrapper of wrappers) {
    for (const child of wrapper.getChildren<TextNode>()) {
      if (offset <= child.getTextContentSize()) {
        if (point) point.set(child.getKey(), offset, "text");
        else child.select(offset, offset);
        return;
      }
      offset -= child.getTextContentSize();
    }
    if (offset === 0) {
      if (point)
        point.set(wrapper.getKey(), wrapper.getChildrenSize(), "element");
      else wrapper.selectEnd();
      return;
    }
    offset--;
  }
}

/** Remove owned payload/boundaries, moving surviving nodes rather than restoring snapshots. */
function detach(group: Group): { paragraph: ParagraphNode; index: number } {
  const paragraph = group.paragraphs[0]!;
  const index = group.wrappers[0]!.getIndexWithinParent();
  for (const wrapper of group.wrappers) wrapper.remove();
  for (const right of group.paragraphs.slice(1)) {
    paragraph.append(...right.getChildren());
    right.remove();
  }
  return { paragraph, index };
}
function install(
  paragraph: ParagraphNode,
  index: number,
  fragment: ReviewFragment,
  id: string,
  extensions: readonly ReviewExtensionEnvelope[] = [],
): ReviewFragmentNode[] {
  const suffix = paragraph.getChildren().slice(index);
  const wrappers: ReviewFragmentNode[] = [];
  let current = paragraph;
  for (const [i, part] of fragment.entries()) {
    if (i) {
      const next = $createParagraphNode().setTextFormat(part.emptyFormat ?? 0);
      current.insertAfter(next);
      current = next;
    }
    const wrapper = $createReviewFragmentNode(
      id,
      i > 0,
      part.emptyFormat ?? 0,
      extensions,
    );
    wrapper.append(
      ...part.runs
        .filter((run) => run.text.length)
        .map((run) => $createTextNode(run.text).setFormat(run.format)),
    );
    if (i === 0) current.splice(index, 0, [wrapper]);
    else current.append(wrapper);
    wrappers.push(wrapper);
  }
  if (current !== paragraph) current.append(...suffix);
  return wrappers;
}
function normalize(wrappers: ReviewFragmentNode[]): void {
  const id = wrappers[0]!.getProposalId();
  if (wrappers.length === 1) {
    const wrapper = wrappers[0]!;
    if (!wrapper.getTextContentSize()) {
      const parent = wrapper.getParentOrThrow();
      const index = wrapper.getIndexWithinParent();
      wrapper.remove();
      parent.select(index, index);
      return;
    }
    const selection = $getSelection();
    const saved = $isRangeSelection(selection)
      ? [selection.anchor, selection.focus].map((point) => ({
          point,
          key: point.key,
          offset: point.offset,
          type: point.type,
        }))
      : [];
    const insertion = $createReviewInsertionNode(id, wrapper.getExtensions());
    wrapper.insertBefore(insertion);
    insertion.append(...wrapper.getChildren());
    wrapper.remove();
    for (const { point, key, offset, type } of saved)
      point.set(
        key === wrapper.getKey() ? insertion.getKey() : key,
        offset,
        type,
      );
  } else if (
    wrappers.length === 2 &&
    wrappers.every((node) => node.getTextContentSize() === 0)
  ) {
    const right = wrappers[1]!;
    const marker = $createReviewBoundaryNode(
      id,
      "split",
      wrappers[0]!.getEmptyFormat(),
      right.getEmptyFormat(),
      wrappers[0]!.getExtensions(),
    );
    right.insertBefore(marker);
    const parent = right.getParentOrThrow();
    wrappers.forEach((node) => node.remove());
    const selection = parent.select(1, 1);
    $setReviewInputFormat(selection, marker.getSideFormat("right"));
  }
}
function validateRegistration(): ReviewIntentOutcome | null {
  if (
    ![ReviewFragmentNode, ReviewInsertionNode, ReviewBoundaryNode].every(
      (node) => $getEditor().hasNode(node),
    )
  )
    return refusal(
      "unsupported-structure",
      "Register fragment, insertion, and boundary nodes for fragment authoring and normalization.",
    );
  return validateStructuralState();
}
function editLocal(
  local: FragmentSelection,
  inserted: ReviewFragment,
): ReviewIntentOutcome {
  const blocked = validateRegistration();
  if (blocked) return blocked;
  const format = $getReviewInputFormat(local.selection);
  const source = units(payload(local.group));
  let offset = 0;
  const before: Unit[] = [],
    after: Unit[] = [];
  for (const unit of source) {
    if (offset < local.start) before.push(unit);
    if (offset >= local.end) after.push(unit);
    offset += unit.text.length;
  }
  const added = units(inserted);
  const next = fromUnits(
    [...before, ...added, ...after],
    local.group.wrappers[0]!.getEmptyFormat(),
  );
  const id = local.group.wrappers[0]!.getProposalId();
  const extensions = local.group.wrappers[0]!.getExtensions();
  const { paragraph, index } = detach(local.group);
  const wrappers = install(paragraph, index, next, id, extensions);
  selectOffset(
    wrappers,
    local.start + added.reduce((n, u) => n + u.text.length, 0),
  );
  normalize(wrappers);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) $setReviewInputFormat(selection, format);
  return changed();
}

/** Input is already normalized text-and-paragraph content; clipboard conversion belongs to #67. */
export function $insertReviewFragment(
  fragment: ReviewFragment,
  options: ReviewAuthoringOptions = {},
): ReviewIntentOutcome {
  if (
    !Array.isArray(fragment) ||
    !fragment.length ||
    fragment.some(
      (part) =>
        !part ||
        !Array.isArray(part.runs) ||
        (part.emptyFormat !== undefined &&
          !isSupportedFormat(part.emptyFormat)) ||
        part.runs.some(
          (run: ReviewFormatRun) =>
            !run ||
            typeof run.text !== "string" ||
            /[\r\n]/.test(run.text) ||
            !isSupportedFormat(run.format),
        ),
    )
  )
    return refusal(
      "unsupported-input",
      "Expected normalized paragraphs with supported inline format runs and no embedded line breaks.",
    );
  if (
    fragment.length === 1 &&
    fragment[0]!.runs.every((run: ReviewFormatRun) => !run.text.length)
  )
    return unchanged();
  const selectionBefore = $getSelection();
  const inherited = $isRangeSelection(selectionBefore)
    ? $getReviewInputFormat(selectionBefore)
    : 0;
  const normalizedInput = fragment.map((part) => ({
    ...part,
    emptyFormat: part.emptyFormat ?? inherited,
  }));
  const local = inspectFragmentSelection();
  if (local)
    return local.status === "ready"
      ? editLocal(local.value, normalizedInput)
      : local;
  const blocked = validateRegistration();
  if (blocked) return blocked;
  const inspected = inspectReviewTarget();
  if (inspected.status !== "ready") return inspected;
  const target = inspected.value;
  if (target.kind !== "accepted-caret")
    return refusal(
      "unsupported-target",
      "Fragment creation requires a collapsed accepted-side target.",
    );
  const point = target;
  let index = point.childIndex;
  if (point.node && point.offset === point.node.getTextContentSize()) index++;
  if (
    point.paragraph
      .getChildren()
      .some(
        (node) => $isReviewBoundaryNode(node) && node.getKind() === "merge",
      ) ||
    ((!point.node ||
      point.offset === 0 ||
      point.offset === point.node.getTextContentSize()) &&
      [
        point.paragraph.getChildAtIndex(index - 1),
        point.paragraph.getChildAtIndex(index),
      ].some($isReviewBoundaryNode))
  )
    return refusal(
      "unsafe-proposal-intersection",
      "Fragment placement cannot depend on a pending structural boundary.",
    );
  const identity = prepareProposalId(options);
  if (identity.status !== "ready") return identity;
  if (
    point.node &&
    point.offset > 0 &&
    point.offset < point.node.getTextContentSize()
  ) {
    point.node.splitText(point.offset);
    index = point.node.getIndexWithinParent() + 1;
  }
  const wrappers = install(
    point.paragraph,
    index,
    normalizedInput,
    identity.value,
  );
  wrappers.at(-1)!.selectEnd();
  normalize(wrappers);
  const selection = $getSelection();
  if ($isRangeSelection(selection))
    $setReviewInputFormat(selection, $getReviewInputFormat(selection));
  return changed();
}

/** Claim fragment-owned text insertion; null means the text contract owns it. */
export function $claimFragmentInsertion(
  text: string,
): ReviewIntentOutcome | null {
  const local = inspectFragmentSelection();
  if (!local) return null;
  if (local.status !== "ready") return local;
  if (/[\r\n]/.test(text))
    return refusal(
      "unsupported-input",
      "Use normalized fragment input for multiline content.",
    );
  if (!text.length && local.value.start === local.value.end) return unchanged();
  return editLocal(local.value, [
    {
      runs: text
        ? [{ text, format: $getReviewInputFormat(local.value.selection) }]
        : [],
    },
  ]);
}
export function $claimFragmentSplit(): ReviewIntentOutcome | null {
  const local = inspectFragmentSelection();
  if (!local) return null;
  if (local.status !== "ready") return local;
  if (local.value.start !== local.value.end)
    return refusal(
      "unsupported-target",
      "Enter requires a collapsed fragment caret.",
    );
  const format = $getReviewInputFormat(local.value.selection);
  return editLocal(local.value, [
    { runs: [], emptyFormat: format },
    { runs: [], emptyFormat: format },
  ]);
}
export function $claimFragmentDeletion(
  backward: boolean,
  granularity: "character" | "word",
): ReviewIntentOutcome | null {
  const local = inspectFragmentSelection();
  if (!local) return null;
  if (local.status !== "ready") return local;
  const value = local.value;
  if (value.start === value.end) {
    const text = units(payload(value.group))
      .map((u) => u.text)
      .join("");
    const at = value.start;
    if ((backward && at === 0) || (!backward && at === text.length))
      return refusal(
        "deletion-target-unavailable",
        "Deletion cannot cross a fragment's outer ownership boundary.",
      );
    let target = backward
      ? previousCharacterOffset(text, at)
      : nextCharacterOffset(text, at);
    if (
      granularity === "word" &&
      text.slice(Math.min(at, target), Math.max(at, target)) !== "\n"
    ) {
      const side = backward
        ? text.slice(0, at).split("\n").at(-1)!
        : text.slice(at).split("\n")[0]!;
      const pattern = backward
        ? /(?:[\p{L}\p{N}\p{M}_]+|[^\p{L}\p{N}\p{M}_\s]+)[^\S\n]*$|[^\S\n]+$/u
        : /^[^\S\n]*(?:[\p{L}\p{N}\p{M}_]+|[^\p{L}\p{N}\p{M}_\s]+)|^[^\S\n]+/u;
      const length = side.match(pattern)?.[0].length ?? Math.abs(target - at);
      target = backward ? at - length : at + length;
    }
    value.start = Math.min(at, target);
    value.end = Math.max(at, target);
  }
  return editLocal(value, [{ runs: [] }]);
}

export function $claimFragmentFormatting(
  apply: (format: number) => number,
): ReviewIntentOutcome | null {
  const local = inspectFragmentSelection();
  if (!local) return null;
  if (local.status !== "ready") return local;
  const { group, selection, start, end, backward } = local.value;
  const blocked = validateRegistration();
  if (blocked) return blocked;
  if (start === end) {
    const current = $getReviewInputFormat(selection);
    const next = apply(current);
    if (next === current) return unchanged();
    $setReviewInputFormat(selection, next);
    return changed();
  }
  let offset = 0,
    modified = false;
  const next = units(payload(group)).map((unit) => {
    const inside = offset >= start && offset < end;
    offset += unit.text.length;
    const format = inside ? apply(unit.format) : unit.format;
    modified ||= format !== unit.format;
    return { ...unit, format };
  });
  if (!modified) return unchanged();
  const id = group.wrappers[0]!.getProposalId();
  const location = detach(group);
  const wrappers = install(
    location.paragraph,
    location.index,
    fromUnits(next, group.wrappers[0]!.getEmptyFormat()),
    id,
  );
  selectOffset(wrappers, backward ? end : start, selection.anchor);
  selectOffset(wrappers, backward ? start : end, selection.focus);
  selection.setFormat(apply(selection.format));
  return changed();
}
export function $getFragmentSelectionFormat(): number | null {
  const local = inspectFragmentSelection();
  if (!local || local.status !== "ready") return null;
  let offset = 0,
    format = 15;
  for (const unit of units(payload(local.value.group))) {
    if (offset >= local.value.start && offset < local.value.end)
      format &= unit.format;
    offset += unit.text.length;
  }
  return format;
}

export function resolveFragment(
  id: string,
  accept: boolean,
): ReviewIntentOutcome {
  const blocked = validateStructuralState();
  if (blocked) return blocked;
  const prepared = inspectFragment(id);
  if (prepared.status !== "ready") return prepared;
  const group = prepared.value;
  const selection = $getSelection();
  const touches =
    $isRangeSelection(selection) &&
    [selection.anchor, selection.focus].some(
      (point) => offsetInGroup(point, group) !== null,
    );
  if (accept) {
    for (const wrapper of group.wrappers) {
      for (const child of wrapper.getChildren()) wrapper.insertBefore(child);
      const parent = wrapper.getParentOrThrow();
      const index = wrapper.getIndexWithinParent();
      wrapper.remove();
      if (touches) parent.select(index, index);
    }
  } else {
    const { paragraph, index } = detach(group);
    if (touches) paragraph.select(index, index);
  }
  return changed();
}
/** Explicit keyboard crossing exposes both endpoint associations, including empty components. */
export function $moveReviewFragmentCaret(backward: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const local = inspectFragmentSelection();
  if (local?.status === "ready") {
    const { group, start } = local.value;
    const total = units(payload(group)).reduce((n, u) => n + u.text.length, 0);
    if ((backward && start === 0) || (!backward && start === total)) {
      const wrapper = backward ? group.wrappers[0]! : group.wrappers.at(-1)!;
      const parent = wrapper.getParentOrThrow();
      const index = wrapper.getIndexWithinParent() + (backward ? 0 : 1);
      parent.select(index, index);
      return true;
    }
    const wrapper = fragmentAtPoint(selection.anchor)!;
    const pointOffset = offsetInGroup(selection.anchor, {
      wrappers: [wrapper],
    })!;
    if (
      (backward && pointOffset === 0) ||
      (!backward && pointOffset === wrapper.getTextContentSize())
    ) {
      const index = group.wrappers.indexOf(wrapper) + (backward ? -1 : 1);
      const neighbor = group.wrappers[index];
      if (neighbor) {
        if (backward) neighbor.selectEnd();
        else neighbor.selectStart();
        return true;
      }
    }
    return false;
  }
  const node = selection.anchor.getNode();
  let neighbor: import("lexical").LexicalNode | null = null;
  if (isRootParagraph(node))
    neighbor = node.getChildAtIndex(
      selection.anchor.offset + (backward ? -1 : 0),
    );
  else if (
    $isTextNode(node) &&
    isRootParagraph(node.getParent()) &&
    selection.anchor.offset === (backward ? 0 : node.getTextContentSize())
  )
    neighbor = backward ? node.getPreviousSibling() : node.getNextSibling();
  if (!$isReviewFragmentNode(neighbor)) return false;
  const group = inspectFragment(neighbor.getProposalId());
  if (group.status !== "ready") return false;
  if (
    backward
      ? neighbor !== group.value.wrappers.at(-1)
      : neighbor !== group.value.wrappers[0]
  )
    return false;
  if (backward) neighbor.selectEnd();
  else neighbor.selectStart();
  return true;
}
