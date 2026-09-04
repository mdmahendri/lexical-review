# lexical-review

## Installation

```bash
npm install lexical-review \
  'lexical@>=0.45.0 <0.50.0' \
  '@lexical/react@>=0.45.0 <0.50.0' \
  '@lexical/clipboard@>=0.45.0 <0.50.0' \
  '@lexical/utils@>=0.45.0 <0.50.0' \
  react react-dom
```

## Compatibility

The package declares Lexical peer compatibility `>=0.45.0 <0.50.0`.
`lexical`, `@lexical/react`, `@lexical/clipboard`, and `@lexical/utils` must
be installed at the same version within that range.

The package declares React peer compatibility for React 18 and React 19, and
`react` and `react-dom` must use the same version. CI exercises the supported
Lexical minors and browser boundary scenarios in Chromium, Firefox, and
Playwright WebKit. Playwright WebKit results do not certify native Safari or
iOS Safari.

## Entrypoints

- React-free core entrypoint: `import { ReviewInsertionNode } from "lexical-review"`.
- Client/editor integration is available through the v3 session registration
  and explicitly named legacy v2 editor-wide exports.

Core nodes, helpers, and types are exported only from the root entrypoint. The root entrypoint does not import React or `@lexical/react`, so it is suitable for server-side model and serialization code; DOM rendering and editor registration require a client environment.

### Version 3 review-session authoring

The React-free root validates and opens a native version 3 review document
against a Lexical editor. Opening validates before installing any state. The
session reads and updates the current Lexical `EditorState`; it does not keep a
parallel authoritative snapshot. Live pending proposals are represented
directly by proposal-bearing Lexical nodes and remain editable in place. There
is no identityless draft or proposal-finalization phase.

Native serialization preserves the current pending proposal-bearing nodes
directly. A serialized value is a snapshot, and a successor native document
contains pending proposals only; accepted or rejected proposals are not kept as
resolution history. Accepted-state targets and payloads are derived when a
serialized native document crosses the WER adapter boundary, not maintained as
live coordinates for ordinary editing.

The v3 client route registers the session against the live Lexical tree:

```tsx
import { ReviewSessionPlugin } from "lexical-review/client";

<ReviewSessionPlugin session={session} />;
```

It keeps accepted-side and proposal-side targeting distinct, edits compatible
pending insertion/deletion nodes in place, and reports ambiguous, mixed, and
structurally unsafe targets as no-mutation refusals. The lower-level
`registerReviewSession` export is available for hosts that do not use React.
The session must be registered with the same Lexical editor that opened it.

## Legacy editor-wide review mode

The v2 segment implementation remains available behind explicitly named
`Legacy*` compatibility exports. It is not v3 review state or native
serialization authority:

```tsx
import { TextNode } from "lexical";
import {
  $createLegacyReviewTextNode,
  LegacyReviewTextNode,
} from "lexical-review";

const initialConfig = {
  nodes: [
    LegacyReviewTextNode,
    {
      replace: TextNode,
      with: (node: TextNode) =>
        $createLegacyReviewTextNode(node.getTextContent(), "original"),
      withKlass: LegacyReviewTextNode,
    },
  ],
};
```

`LegacyReviewTextPlugin` and `registerLegacyReviewText` are exported from
`lexical-review/client` for this compatibility surface.

Please visit the [homepage](https://github.com/mahendrimd/lexical-review).

## Rendering contract

For inserted and deleted text, the review marker is always the outermost DOM
element. Lexical formatting and inline styles are nested inside the marker,
for example: `<ins><strong>inserted text</strong></ins>`.
