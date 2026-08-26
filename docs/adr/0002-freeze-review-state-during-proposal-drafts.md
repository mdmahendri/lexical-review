# Freeze review state during proposal drafts

While an ordinary local proposal draft is open, the accepted document state and the proposal state underlying its Lexical projection remain frozen until the draft is exported or discarded. The draft is never rebased: operations that would change that coordinate frame must wait. This preserves editor-local node and offset anchors without recording transient draft positions in the immutable proposal ledger, and avoids timing-dependent behavior from remapping a mutable draft through concurrent programmatic proposal creation or resolution.
