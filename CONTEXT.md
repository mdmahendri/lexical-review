# Lexical Review

Lexical Review defines predictable review-mode editing interactions for Lexical applications. It can exchange a bounded set of independently reviewable changes without making interchange semantics dictate editor interactions.

## Language

**Review interaction**:
An observable editing behavior that creates, changes, or resolves reviewable content while review mode is active.
_Avoid_: Vendor behavior, standard interaction

**Interaction contract**:
The library-owned definition of how editing inputs become review interactions and observable document outcomes.
_Avoid_: Interchange standard, vendor emulation

**Interaction evidence**:
Primary-source observations used to justify or challenge an interaction contract without making any one vendor's behavior authoritative.
_Avoid_: Standard requirement, vendor vote

**Proposal draft**:
A mutable local pending change being authored before it becomes a revision proposal. It has no portable proposal identity, is never rebased beyond its frozen accepted document state, and may be discarded without proposal resolution.
_Avoid_: Revision proposal, pending proposal

**Proposal replacement**:
An explicitly acknowledged authoring flow that supersedes an immutable revision proposal with a newly authored proposal identity. The original stays pending while an ordinary proposal draft is authored; discarding that draft leaves the original untouched.
_Avoid_: Edit proposal, deletion draft

**Revision proposal**:
An independently reviewable lifecycle record representing a pending document change, aligned with the Web Editor Revisions definition.
_Avoid_: Edit operation, history entry, review segment

**Review segment**:
A contiguous text span classified as original, inserted, or deleted for editing and presentation. A review segment is not necessarily an independently identifiable revision proposal.
_Avoid_: Revision proposal, suggestion

**Accepted document state**:
The authoritative document content against which pending revision proposals are interpreted.
_Avoid_: Current editor view, history snapshot

**Interchange adapter**:
A direction-specific mapping between Lexical Review's interaction model and a versioned Web Editor Revisions interchange document.
_Avoid_: Universal converter, native model

**Capability demo**:
An executable demonstration of supported review interactions, APIs, and interchange outcomes. It is not a required host-application layout or a reusable review interface.
_Avoid_: Product UI, interaction contract

**Adoption feedback**:
Implementation evidence that may motivate a future change to Web Editor Revisions without silently changing the meaning of an existing version.
_Avoid_: Local exception, implementation override
