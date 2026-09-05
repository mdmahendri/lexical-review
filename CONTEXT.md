# Lexical Review

Lexical Review defines predictable review-mode editing interactions for Lexical applications. It can exchange a bounded set of independently reviewable changes without making interchange semantics dictate editor interactions.

## Language

**Accepted document state**:
The authoritative document content against which pending revision proposals are interpreted.
_Avoid_: Current editor view, history snapshot

**Review intent**:
The semantic meaning of an attempted edit in review mode, such as insertion, deletion, replacement, or structural change. It is distinct from the observable review interaction that realizes it; one intent may be realized by one or more revision proposals or declined when the interaction is unsupported or unsafe.
_Avoid_: Raw input event, review interaction, revision proposal

**Revision proposal**:
An independently reviewable pending change that expresses a review intent. Its content, formatting, and supported placement may evolve during authoring.
_Avoid_: Proposal draft, finalized proposal, immutable proposal record, edit operation, history entry, review segment

**Review state**:
The mutable working representation of accepted content and pending revision proposals during an authoring session. It is distinct from a serialized review document and its visible review projection.
_Avoid_: Review projection, WER interchange document, DOM state

**Review document**:
Lexical Review's native serialized representation of accepted content and pending revision proposals. It contains only current pending proposals, without accepted or rejected resolution history.
_Avoid_: WER interchange document, review projection, accepted document state

**Authoring session**:
A period of editing during which review state evolves from an input review document. Saving produces a successor review document without ending the session.
_Avoid_: Editor instance, review document

**Review projection**:
The visible, editable view of review state that shows accepted content and pending revision proposals.
_Avoid_: Review state, accepted document state, all-accepted preview

**Accepted-state preview**:
A read-only projection of accepted document state without applying pending revision proposals. It does not reject or otherwise resolve those proposals.
_Avoid_: Review projection, all-rejected document

**All-accepted preview**:
A read-only projection of the document outcome that would result from accepting every pending revision proposal, without resolving those proposals or advancing accepted document state. Producing the preview throws an error if errors prevent that outcome from being determined.
_Avoid_: Review projection, accepted document state

**Review segment**:
A contiguous text span classified as original, inserted, or deleted for editing and presentation. A review segment is not necessarily an independently identifiable revision proposal.
_Avoid_: Revision proposal, suggestion

**Review interaction**:
An observable editing behavior that creates, changes, or resolves reviewable content while review mode is active.
_Avoid_: Vendor behavior, standard interaction

**Atomic document-fragment insertion**:
A single revision proposal that inserts an ordered text-and-paragraph fragment at one accepted-state point and can be accepted or rejected only as a whole.
_Avoid_: Decomposed paste, proposal group

**No-mutation refusal**:
A machine-readable outcome that declines a review interaction while preserving accepted content, pending work, the review projection, and the logical selection.
_Avoid_: Silent failure, fallback edit

**Interaction contract**:
The library-owned definition of how editing inputs become review interactions and observable document outcomes.
_Avoid_: Interchange standard, vendor emulation

**Interaction evidence**:
Primary-source observations used to justify or challenge an interaction contract without making any one vendor's behavior authoritative.
_Avoid_: Standard requirement, vendor vote

**Clipboard projection**:
A content-only representation of a selected review projection used by ordinary copy or cut. It carries no portable proposal identity, and generic markup cannot establish one.
_Avoid_: Proposal transfer, interchange document

**Clipboard content**:
Untrusted plain or rich content consumed by ordinary paste. Supported presentation may survive, but foreign review markup and metadata never confer revision-proposal identity.
_Avoid_: Proposal fragment, interchange document

**Text composition**:
A period of native text input with provisional intermediate text that may produce a review intent when completed. It does not itself define revision-proposal identity.
_Avoid_: IME commit, composition proposal

**Native review extension**:
Additional metadata attached to a review document or revision proposal without changing the core meaning of that review document version.
_Avoid_: Unknown field, WER extension

**Accepted-side association**:
The meaning that a caret adjacent to a pending revision proposal belongs to accepted document state rather than to that proposal.
_Avoid_: Accepted affinity, document-side caret

**Proposal-side association**:
The meaning that a caret adjacent to or within a pending revision proposal belongs to that proposal rather than to accepted document state. Supported editing operations may continue or correct the proposal locally.
_Avoid_: Proposal affinity, proposal-local edit permission

**Web Editor Revisions (WER)**:
An implementation-independent family of interchange models for accepted document state and independently reviewable revision proposals, including portable identity, targeting, resolution, remapping, canonical serialization, and mapping outcomes. It does not define editor interactions, UI, runtime structures, transport, private persistence, concurrency, or undo/redo.
_Avoid_: Lexical Review interaction contract, editor model

**[Web Editor Revisions version 1 (WER v1)](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md)**:
The first version of the WER interchange model, bounded to ordered paragraphs, exact text, four effective inline-formatting properties, and six proposal kinds: insertion, deletion, atomic replacement, formatting, paragraph split, and paragraph merge. It defines portable document semantics rather than editor interactions.
_Avoid_: Unversioned WER when model semantics matter, general editor standard

**WER interchange document**:
A portable artifact conforming to a WER model that contains accepted document state and pending revision proposals, with optional reports and extensions. It is distinct from a native review document and live review state.
_Avoid_: Review document, review state, editor serialization

**Interchange adapter**:
A mapping from native review documents to WER interchange documents, or the reverse. It reports normalization, synthesis, refusal, or loss under a declared mapping profile.
_Avoid_: Universal converter, native model

**Capability demo**:
An executable demonstration of supported review interactions, APIs, and interchange outcomes. It is not a required host-application layout or a reusable review interface.
_Avoid_: Product UI, interaction contract

**Adoption feedback**:
Implementation evidence that may motivate a future change to Web Editor Revisions without silently changing the meaning of an existing version.
_Avoid_: Local exception, implementation override
