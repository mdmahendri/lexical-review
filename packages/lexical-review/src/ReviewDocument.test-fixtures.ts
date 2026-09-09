export function text(value: string, format = 0) {
  return {
    detail: 0,
    format,
    mode: "normal",
    style: "",
    text: value,
    type: "text",
    version: 1,
  };
}

export function paragraph(children: unknown[], textFormat = 0) {
  return {
    children,
    direction: null,
    format: "",
    indent: 0,
    textFormat,
    textStyle: "",
    type: "paragraph",
    version: 1,
  };
}

export function reviewNode(
  type: "review-deletion" | "review-insertion",
  proposalId: string,
  children: unknown[],
) {
  return {
    children,
    direction: null,
    extensions: [],
    format: "",
    indent: 0,
    proposalId,
    type,
    version: 1,
  };
}

export function formattingNode(
  proposalId: string,
  children: unknown[],
  accepted: unknown[],
) {
  return {
    accepted,
    children,
    direction: null,
    extensions: [],
    format: "",
    indent: 0,
    proposalId,
    type: "review-formatting",
    version: 1,
  };
}

export function boundaryNode(
  proposalId: string,
  kind: "split" | "merge",
  leftFormat = 0,
  rightFormat = 0,
) {
  return {
    extensions: [],
    kind,
    leftFormat,
    proposalId,
    rightFormat,
    type: "review-boundary",
    version: 1,
  };
}

export function fragmentNode(
  proposalId: string,
  children: unknown[],
  startsParagraph: boolean,
  emptyFormat = 0,
) {
  return {
    children,
    direction: null,
    emptyFormat,
    extensions: [],
    format: "",
    indent: 0,
    proposalId,
    startsParagraph,
    type: "review-fragment",
    version: 1,
  };
}

export function reviewDocument(children: unknown[]) {
  return {
    root: {
      $: { "lexical-review": { extensions: [], version: 3 } },
      children,
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}
