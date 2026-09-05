import {
  $getEditor,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type RangeSelection,
} from "lexical";
import { inspectSelection } from "./ReviewSelectionPreparation";

type LocalFormat = {
  key: string;
  offset: number;
  type: string;
  format: number;
};
const localFormats = new WeakMap<LexicalEditor, LocalFormat>();

function matches(selection: RangeSelection, local: LocalFormat): boolean {
  return (
    selection.isCollapsed() &&
    selection.anchor.key === local.key &&
    selection.anchor.offset === local.offset &&
    selection.anchor.type === local.type
  );
}

export function $getReviewInputFormat(selection: RangeSelection): number {
  const local = localFormats.get($getEditor());
  if (local && matches(selection, local)) return local.format;
  const point = selection.anchor;
  const node = point.getNode();
  if ($isTextNode(node)) return node.getFormat();
  if ($isElementNode(node)) {
    const next = node.getChildAtIndex(point.offset);
    const previous = node.getChildAtIndex(point.offset - 1);
    if ($isTextNode(previous)) return previous.getFormat();
    if ($isTextNode(next)) return next.getFormat();
    return node.getTextFormat();
  }
  return 0;
}

export function $setReviewInputFormat(
  selection: RangeSelection,
  format: number,
): void {
  selection.setFormat(format);
  localFormats.set($getEditor(), {
    key: selection.anchor.key,
    offset: selection.anchor.offset,
    type: selection.anchor.type,
    format,
  });
}

/** Selection-only state is local to this editor and never serialized as a proposal. */
export function registerReviewInputFormatting(
  editor: LexicalEditor,
): () => void {
  const unregister = editor.registerUpdateListener(
    ({ editorState, prevEditorState }) => {
      const previous = prevEditorState.read(() => {
        const selection = $getSelection();
        return $isRangeSelection(selection) && selection.isCollapsed()
          ? {
              key: selection.anchor.key,
              offset: selection.anchor.offset,
              type: selection.anchor.type,
              format: selection.format,
            }
          : null;
      });
      const destination = editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed())
          return null;
        if (previous && matches(selection, previous)) return null;
        return {
          key: selection.anchor.key,
          offset: selection.anchor.offset,
          type: selection.anchor.type,
        };
      });
      if (!destination) {
        editorState.read(() => {
          const selection = $getSelection();
          const local = localFormats.get(editor);
          if (
            local &&
            (!$isRangeSelection(selection) || !matches(selection, local))
          )
            localFormats.delete(editor);
        });
        return;
      }
      const local = localFormats.get(editor);
      if (
        local &&
        (local.key !== destination.key ||
          local.offset !== destination.offset ||
          local.type !== destination.type)
      )
        localFormats.delete(editor);
      editor.update(
        () => {
          const inspection = inspectSelection();
          if (inspection.status !== "ready" || !inspection.value.collapsed)
            return;
          const selection = inspection.value.selection;
          // Another queued edit may already have changed the destination.
          if (
            selection.anchor.key !== destination.key ||
            selection.anchor.offset !== destination.offset ||
            selection.anchor.type !== destination.type
          )
            return;
          const format = $getReviewInputFormat(selection);
          if (selection.format !== format) selection.setFormat(format);
        },
        { discrete: true },
      );
    },
  );
  return () => {
    unregister();
    localFormats.delete(editor);
  };
}
