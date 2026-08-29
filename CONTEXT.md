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

**Proposal draft**:
A live-only mutable candidate change within review state before it receives stable proposal identity. It may be edited or discarded without proposal resolution and is never part of a native review document or WER interchange document.
_Avoid_: Revision proposal, pending proposal

**Proposal finalization**:
The local authoring transition that validates one proposal draft, assigns immutable semantic identity, and makes it a revision proposal within review state. It may be requested explicitly or by draft settlement before another state-changing semantic operation. It does not itself serialize a review document or produce a WER interchange document.
_Avoid_: Proposal draft export, WER export, proposal resolution, commit

**Draft settlement**:
The common preflight applied before a state-changing semantic operation when a proposal draft exists. Compatible authoring continues the draft; explicit discard removes it; otherwise the draft is finalized before the requested operation proceeds, and both changes commit atomically. Caret, selection, focus, navigation, preview, and content-only copy do not invoke draft settlement.
_Avoid_: Blur commit, caret finalization, implicit export

**Text composition**:
A native editor-input session with provisional intermediate text. Each completed session is normalized by the editor integration into zero or one insertion, deletion, or replacement intention; it is neither a proposal draft nor a revision proposal.
_Avoid_: IME commit, composition proposal

**Proposal reauthoring**:
An explicit flow that uses a pending revision proposal as the starting point for a new proposal draft without modifying the original. Finalizing that draft atomically rejects the original and creates a new pending proposal with new identity; discarding it leaves the original pending.
_Avoid_: Proposal replacement, proposal revision, edit proposal, mutate proposal

**Revision proposal**:
An independently reviewable lifecycle record whose semantic identity, kind, payload, and semantic attachment are immutable after finalization. Its stored target locator and base reference may be deterministically remapped to a successor accepted document state without changing that attachment.
_Avoid_: Edit operation, history entry, review segment

**Semantic attachment**:
The stable meaning of where a revision proposal applies across accepted document state transitions, independent of remappable target coordinates or base references.
_Avoid_: Immutable coordinates, selection bookmark

**Review document**:
Lexical Review's native, Lexical-shaped serialization of accepted content and finalized revision proposals. It excludes the live proposal draft, is distinct from a WER interchange document, and need not satisfy the WER schema.
_Avoid_: WER interchange document, review projection, accepted document state

**Native review extension**:
A stable URI-identified, versioned data envelope at document or revision-proposal scope that adds metadata without changing the core semantics of a review document version.
_Avoid_: Unknown field, WER extension

**Review state**:
The mutable working representation of accepted content, revision proposals, and zero or one active proposal draft during an authoring session. It is distinct from both its visible projection and serialized forms.
_Avoid_: Review projection, WER interchange document, DOM state

**Review segment**:
A contiguous text span classified as original, inserted, or deleted for editing and presentation. A review segment is not necessarily an independently identifiable revision proposal.
_Avoid_: Revision proposal, suggestion

**Accepted document state**:
The authoritative document content against which pending revision proposals are interpreted.
_Avoid_: Current editor view, history snapshot

**Review projection**:
The visible editor view reconciled from review state, with accepted content, revision proposals, and proposal drafts kept observable. It is neither a serialized review document nor a WER interchange document.
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
A direction-specific mapping between a serialized Lexical Review native review document and a WER interchange document. It never receives live review state or an active proposal draft, and it validates the boundary and reports normalization, synthesis, refusal, or loss under a declared mapping profile.
_Avoid_: Universal converter, native model

**Capability demo**:
An executable demonstration of supported review interactions, APIs, and interchange outcomes. It is not a required host-application layout or a reusable review interface.
_Avoid_: Product UI, interaction contract

**Adoption feedback**:
Implementation evidence that may motivate a future change to Web Editor Revisions without silently changing the meaning of an existing version.
_Avoid_: Local exception, implementation override
