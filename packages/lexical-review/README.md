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

### Pending insertion proposals

Use the same root operations as the client command route inside a Lexical
update. Identity is assigned on creation and remains stable while content is
continued or corrected:

```ts
import {
  $insertReviewText,
  $inspectReviewInsertion,
  $acceptReviewInsertion,
  $rejectReviewInsertion,
  $removeReviewInsertion,
} from "lexical-review";

editor.update(() => {
  const outcome = $insertReviewText("new text", {
    proposalIdFactory: () => crypto.randomUUID(),
  });
  // Handle changed, unchanged, or refused outcomes.
});

editor.getEditorState().read(() => $inspectReviewInsertion(proposalId));
editor.update(() => $acceptReviewInsertion(proposalId));
// Alternatively: $rejectReviewInsertion(proposalId) or
// $removeReviewInsertion(proposalId), each inside editor.update().
```

The identity factory is optional; the package generates identities by default.
Client hosts can pass the same `proposalIdFactory` to `registerReviewSession`
or `ReviewSessionPlugin`. Duplicate or invalid identities, factory failures,
and unsupported targets are refused before mutation. Unexpected implementation
errors propagate to Lexical's update error handling and rollback; do not catch
and swallow them inside the update callback.

Typing from an accepted text boundary continues an adjacent insertion when its
formatting matches. Typing or replacing a range inside one insertion corrects
that proposal in place. A paragraph element boundary adjacent to a proposal
is ambiguous and is refused. Deleting all insertion content removes the
proposal. The caret follows newly inserted or corrected content.

Acceptance unwraps the insertion into accepted text, preserving formatting.
Rejection removes the proposed text. Explicit removal also removes pending
work, but expresses author removal rather than a review decision. These are
separate operations; none adds a terminal record to native JSON. Resolution
refuses missing, disconnected, or structurally unsupported identities.

## Pending deletion authoring

Inside `editor.update()`, call `$deleteReviewText(backward, options)` to delete
at the current selection. The optional `granularity` is `"character"` (default)
or `"word"`; a nonempty selection always supplies the explicit range. The client
registration handles Backspace, Delete, word deletion, and range removal through
the same operation. Word deletion consumes adjacent whitespace and one Unicode
letter/number/mark or punctuation run, bounded by accepted text or one proposal.

Creation assigns identity immediately. Forward continuation appends accepted
text to the deletion on its left; backward continuation prepends accepted text
to the deletion on its right. Formatting stays on the nested text nodes. The
caret moves to the accepted continuation side. Same-paragraph ranges can extend
a compatible adjacent deletion in the requested direction. No draft, settlement
step, or saved coordinate record is involved.

A nonempty deletion intention inside a pending deletion restores that whole
proposal's accepted text and removes the proposal. Inside a pending insertion,
it removes only the targeted insertion text. A caret facing pending content
from the accepted side of an independent insertion/deletion, or facing outward
from a proposal, refuses without
changing the document or selection. Cross-paragraph and ambiguous ranges also
refuse without mutation.

`$inspectReviewDeletion(proposalId)` reads current node content inside an editor
read/update. `$acceptReviewDeletion(proposalId)` removes the deleted text;
`$rejectReviewDeletion(proposalId)` and `$removeReviewDeletion(proposalId)`
restore it. These update operations retain no terminal record. Saving and
reopening preserves current pending identities and formatting.

## Pending replacement proposals

Selecting accepted text in one paragraph and calling `$insertReviewText("new")`
creates a replacement. `$replaceReviewText("new")` also supports this operation;
an empty string applies deletion semantics, and a collapsed selection with
nonempty text applies insertion semantics. Native typing and controlled
`insertReplacementText` input use the same authoring operations.

A replacement has a `review-deletion` side followed by a `review-insertion`
side with one shared `proposalId`. Each side contains nonempty text. Split
same-type wrappers can normalize within a side. Every occurrence of an identity
must form one contiguous group in one paragraph; accepted text, other proposals,
reversed sides, nested content, and fragments cannot divide the group.

Typing or replacing entirely within the new side retains the identity. Deleting
the last new text cancels the whole replacement and restores the old text.
Deleting against the old side also cancels the replacement, including forward
deletion from an adjacent accepted text boundary. Typing over the old side or
editing across both sides is refused without changing content or selection.

`$inspectReviewReplacement(proposalId)` returns `oldText` and `newText` from the
live nodes. `$acceptReviewReplacement(proposalId)` keeps the new content;
`$rejectReviewReplacement(proposalId)` and `$removeReviewReplacement(proposalId)`
keep the old content. Existing insertion/deletion resolution operations also
resolve the whole replacement when passed its shared identity. No API resolves
one replacement side independently.

For a batch, call `$resolveReviewProposals(ids, "accept" | "reject" | "remove")`
inside `editor.update()`. It validates every group before mutation and resolves
each identity once. Saving preserves pending shared identities and never changes
the authoring session's input document.

To reproduce in the browser fixture, open `/?insertions`, select `AB`, and type
`new`. The editor displays `<del>AB</del><ins>new</ins>`. Select all of `new` and
press Backspace: the editor restores `AB` without either review wrapper.

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
