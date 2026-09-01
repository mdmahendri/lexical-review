# Lexical Review

Lexical Review defines predictable review-mode editing interactions for Lexical applications. It can exchange a bounded set of independently reviewable changes without making interchange semantics dictate editor interactions.

## Language

**Review interaction**:
An observable editing behavior that creates, changes, or resolves reviewable content while review mode is active.
_Avoid_: Vendor behavior, standard interaction

**Compound review interaction**:
A single editing intent whose faithful pending meaning spans multiple revision proposals. Its constituent proposals are independent only when every partial acceptance or rejection remains truthful to that intent.
_Avoid_: Compound gesture, decomposed edit

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

**Authoring session**:
A period of editing during which session-local review state evolves from a serialized input. It ends when that state is discarded or serialized as a successor document.
_Avoid_: Editor instance, review document

**Text composition**:
A native editor-input session with provisional intermediate text. The editor integration normalizes each completed session into zero or one insertion, deletion, or replacement intention and applies it to the live proposal-bearing tree. It is adapter state until completion and does not itself define proposal identity.
_Avoid_: IME commit, composition proposal

**Revision proposal**:
An independently reviewable pending change represented in live review state by one or more package-owned proposal-bearing Lexical nodes. Its identity and kind identify the review intent, while its content, formatting, and supported placement may be edited during authoring. Native serialization preserves its pending proposal-bearing nodes directly; a later native document does not retain accepted or rejected resolution history.
_Avoid_: Proposal draft, finalized proposal, immutable proposal record, edit operation, history entry, review segment

**Semantic attachment**:
The meaning of where a pending revision proposal applies in the live review tree and across accepted document-state interpretations. The proposal-bearing tree location is authoritative during authoring; accepted-state coordinates are derived only at an explicit interchange or other boundary.
_Avoid_: Immutable coordinates, selection bookmark

**Review document**:
Lexical Review's native, Lexical-shaped serialization of accepted content and pending proposal-bearing nodes. It contains the current pending proposals only; accepted or rejected resolution history is not retained. It is distinct from a WER interchange document and need not satisfy the WER schema.
_Avoid_: WER interchange document, review projection, accepted document state

**Native review extension**:
A stable URI-identified, versioned data envelope at document or revision-proposal scope that adds metadata without changing the core semantics of a review document version.
_Avoid_: Unknown field, WER extension

**Review state**:
The mutable working representation of accepted content and pending proposal-bearing nodes during an authoring session. Live proposals are editable in this state and are serialized directly in a native review document. It is distinct from serialized forms.
_Avoid_: Review projection, WER interchange document, DOM state

**Review segment**:
A contiguous text span classified as original, inserted, or deleted for editing and presentation. A review segment is not necessarily an independently identifiable revision proposal.
_Avoid_: Revision proposal, suggestion

**Accepted document state**:
The authoritative document content against which pending revision proposals are interpreted.
_Avoid_: Current editor view, history snapshot

**Accepted-side association**:
The unambiguous meaning that a caret adjacent to pending proposal-bearing work belongs to accepted document state rather than to that pending proposal.
_Avoid_: Accepted affinity, document-side caret

**Proposal-side association**:
The unambiguous meaning that a caret adjacent to or within pending proposal-bearing work belongs to that revision proposal rather than to accepted document state. Supported editing operations may continue or correct the proposal locally.
_Avoid_: Proposal affinity, proposal-local edit permission

**Review projection**:
The visible editable editor view represented directly by live review state, with accepted content and pending proposal-bearing nodes kept observable. It is neither a serialized review document nor a WER interchange document.
_Avoid_: Review state, accepted document state, all-accepted preview

**All-accepted preview**:
A read-only projection of the document outcome produced by accepting every compatible pending revision proposal. It does not resolve those proposals or advance accepted document state.
_Avoid_: Review projection, accepted document state

**Accepted-state preview**:
A read-only projection of accepted document state without applying pending revision proposals. It does not reject or otherwise resolve those proposals.
_Avoid_: Review projection, all-rejected document

**Web Editor Revisions (WER)**:
An implementation-independent family of interchange models for accepted document state and independently reviewable revision proposals, including portable identity, targeting, resolution, remapping, canonical serialization, and mapping outcomes. It does not define editor interactions, UI, runtime structures, transport, private persistence, concurrency, or undo/redo.
_Avoid_: Lexical Review interaction contract, editor model

**[Web Editor Revisions version 1 (WER v1)](https://github.com/mahendrimd/web-editor-revisions/blob/e6ac89287257646888a4eadf692d836eb8feb41b/standards/v1/standard.md)**:
The WER interchange model selected by `modelVersion: "1"` and `serializationProfile: "json-jcs-1"`, bounded to ordered paragraphs, exact text, four effective inline-formatting properties, and six proposal kinds: insertion, deletion, atomic replacement, formatting, paragraph split, and paragraph merge. It constrains portable data and observable adapter outcomes, not Lexical nodes, authoring state, algorithms, or native review-document serialization.
_Avoid_: Unversioned WER when model semantics matter, general editor standard

**WER interchange document**:
A portable artifact conforming to a WER model, containing one accepted document state and a proposal array plus optional reports and extensions. It enters or leaves Lexical Review through an interchange adapter and is neither a native review document nor live review state.
_Avoid_: Review document, review state, editor serialization

**Interchange adapter**:
A direction-specific mapping between a serialized Lexical Review native review document and a WER interchange document. It never receives live review state or an editor, and it validates the boundary and reports normalization, synthesis, refusal, or loss under a declared mapping profile.
_Avoid_: Universal converter, native model

**Capability demo**:
An executable demonstration of supported review interactions, APIs, and interchange outcomes. It is not a required host-application layout or a reusable review interface.
_Avoid_: Product UI, interaction contract

**Adoption feedback**:
Implementation evidence that may motivate a future change to Web Editor Revisions without silently changing the meaning of an existing version.
_Avoid_: Local exception, implementation override
