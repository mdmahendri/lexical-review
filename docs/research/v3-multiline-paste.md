# v3 multiline paste research

Status: retained decision evidence for
[Decide compound-gesture coverage](https://github.com/mahendrimd/lexical-review/issues/42)
and
[Choose clipboard and proposal-transfer semantics](https://github.com/mahendrimd/lexical-review/issues/43).
The primary source snapshots are WER v1 at commit
[`e6ac89287257646888a4eadf692d836eb8feb41b`](https://github.com/mahendrimd/web-editor-revisions/tree/e6ac89287257646888a4eadf692d836eb8feb41b)
and Lexical `v0.49.0` at commit
[`ffe90924bd55b5d450c88de0f9f1c8b228c4a221`](https://github.com/facebook/lexical/tree/ffe90924bd55b5d450c88de0f9f1c8b228c4a221).

## Finding

Multiline paste is an established editor interaction that exact Lexical 0.49
already supports for ordinary editing. The pinned Web Editor Revisions (WER)
v1 does not prohibit multiline paste or define clipboard behavior; it defines
which pending review semantics are portable.

That distinction does not make a collapsed multiline paste representable as
one v1 proposal. Inserting text on both sides of a newly created paragraph
boundary requires text insertion plus structural split semantics. Those parts
belong to one user intention, depend on each other, and do not remain truthful
when independently accepted or rejected. Supporting the interaction therefore
requires Lexical Review to add an atomic compound semantic outside the current
six-kind v1 boundary, or to revisit the earlier product decision that every v3
review interaction must be directly representable in v1. The evidence supports
reconsidering a blanket product refusal; it does not prove that the current v1
proposal model can encode the interaction faithfully.

## What WER v1 actually constrains

WER v1 standardizes accepted state, pending proposals, targets, resolution,
remapping, serialization, and loss reporting. It explicitly excludes editor UI,
DOM/source markup, transport, private persistence, and browser APIs
([scope](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md#L40-L77)).
There is no WER rule saying that a clipboard payload must contain one paragraph.

The v1 core has paragraph-local text targets and explicit paragraph split and
merge proposals ([included model](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md#L42-L56),
[proposal kinds](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md#L212-L256)).
It also requires every proposal to be independently reviewable, permits pending
targets only against accepted-state content, and forbids dependent pending
proposals ([terminology and targets](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md#L81-L95),
[target boundary](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md#L153-L167),
[pending-set compatibility](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md#L262-L280)).

For example, pasting `x\ny` into `AB` at offset 1 proposes the atomic outcome
`Ax` / `yB`. Encoding that as separate insertion and paragraph-split proposals
would allow outcomes such as accepting the split but rejecting `x` or `y`.
Those partial outcomes are not truthful to the paste intention, and text aimed
at a newly created right paragraph cannot initially target that pending
paragraph identity. A selection spanning existing paragraphs adds further
cross-paragraph replacement constraints, but the collapsed case already
exposes the compound-semantic gap.

The WER design record says existing systems differ in anchoring, structure,
provenance, grouping, and atomic replacement, and that the evidence does not
establish universal round-tripping
([boundary decision](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/decisions/01-choose-first-standardization-boundary.md#L20-L45)).
That evidence supports explicit mapping/loss reporting; it does not identify
ordinary newline handling as a WER v1 prohibition.

## Lexical 0.49 behavior

The exact Lexical source already treats multiline clipboard data as normal:

- The rich-text paste pipeline selects
  `application/x-lexical-editor`, then `text/html`, then `text/plain`, then
  `text/uri-list` ([clipboard API](https://github.com/facebook/lexical/blob/ffe90924bd55b5d450c88de0f9f1c8b228c4a221/packages/lexical-clipboard/src/clipboard.ts#L130-L165)).
- Its default plain-text importer tokenizes a `RangeSelection`; each newline
  calls `insertParagraph`, while tabs and text are inserted as their own
  content ([importer](https://github.com/facebook/lexical/blob/ffe90924bd55b5d450c88de0f9f1c8b228c4a221/packages/lexical-clipboard/src/ClipboardImportExtension.ts#L230-L253)).
- The v0.49 tests exercise a two-line payload. Plain-text insertion preserves
  the line break in one paragraph, while the rich-text path produces two
  paragraphs; an HTML fixture modelled on Google Docs also produces two
  paragraphs ([tests](https://github.com/facebook/lexical/blob/ffe90924bd55b5d450c88de0f9f1c8b228c4a221/packages/lexical/src/nodes/__tests__/unit/LexicalTabNode.test.tsx#L52-L115)).

This is evidence that multiline paste is an established editor input shape in
the exact upstream baseline, not evidence that every source HTML shape has the
same semantics. The same test file leaves one messy inline-HTML newline case
as a TODO, so v3 should test and define its HTML normalization boundary.

The current review paste path is narrower than Lexical: it intercepts paste,
requires a collapsed range selection, reads only `text/plain`, and attempts to
split lines before creating insertion nodes. Its line-splitting code removes
the newline delimiters before checking for them, so the current multiline review
path appears not to create paragraph breaks correctly. That is an
implementation/regression-test issue, not a reason to make the v3 product
contract single-paragraph-only.

## Clipboard formats and vendor behavior

“MIME type” here means the format label on one clipboard representation, such
as `text/plain` or `text/html`. A clipboard item can expose multiple
representations, and paste chooses the representation suitable for the target
context ([W3C Clipboard API](https://w3c.github.io/clipboard-apis/#clipboard-data),
[DataTransfer](https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface)).
`application/x-lexical-editor` is Lexical’s private application-defined label;
in v0.49 it carries namespace-checked Lexical JSON, then falls back to HTML or
plain text ([Lexical importer](https://github.com/facebook/lexical/blob/ffe90924bd55b5d450c88de0f9f1c8b228c4a221/packages/lexical-clipboard/src/ClipboardImportExtension.ts#L146-L203)).
It is not WER interchange and does not make foreign review proposals portable.

Cross-vendor variability is real, but it is mainly a payload and review-model
boundary. CKEditor documents that Office/Google Docs paste preserves supported
structure and formatting while depending on the source HTML and configured
features ([paste from Office](https://ckeditor.com/docs/ckeditor5/latest/features/pasting/paste-from-office.html#supported-content),
[comparison limits](https://ckeditor.com/docs/ckeditor5/latest/features/converters/import-word/features-comparison.html#technical-differences)).
Its Track Changes documentation also exposes an explicit product policy for
copying content containing suggestions, including a mode that auto-accepts most
suggestions and documented cases where some block-format suggestions are
dropped ([clipboard integration](https://ckeditor.com/docs/ckeditor5/latest/features/collaboration/track-changes/track-changes.html#clipboard-integration)).
That demonstrates why proposal-preserving transfer needs a policy; it does not
show that multiline ordinary insertion is uncommon or impossible.

## Recommendation for the v3 decision

1. Treat multiline plain and rich paste as a required product decision rather
   than an input-parser limitation. Lexical can normalize the input; foreign
   review markers and provenance still do not become proposal identity.
2. If v3 retains the earlier rule that every admitted review interaction must
   be faithfully representable within WER v1, keep the typed no-mutation
   refusal for multiline paste and record the common-UX gap as adoption
   feedback.
3. If common multiline editing is a v3 requirement, reopen the compound-review
   boundary and specify one atomic Lexical Review semantic outside the current
   six-kind portable subset. Its WER export must truthfully refuse or report an
   unsupported mapping; it must not decompose the paste into independently
   resolvable v1 proposals or infer atomicity from adjacent records
   ([replacement rule](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md#L232-L238)).
4. Decide non-collapsed cross-paragraph replacement separately; it needs both
   removal and insertion across existing structure and is not made safe merely
   by supporting the collapsed case.
5. Whichever boundary is chosen, add fixtures for plain text, HTML paragraph
   wrappers, formatting, soft breaks, tabs, and cross-paragraph selections,
   asserting both the visible projection and the pending proposal shape or
   typed refusal.

## Disposition

Version 3 adds a native atomic document-fragment insertion for collapsed
multiline paste. Its WER v1 export is unsupported without mutation. Ordinary
clipboard data remains content-only, and paragraph-creating paste over a
noncollapsed selection remains refused because version 3 does not define an
atomic document-fragment replacement. The sources do not support rejecting
multiline paste as uncommon; they support treating its portable pending meaning
as unresolved by WER v1.
