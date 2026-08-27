# Freeze serialized inputs during authoring

Lexical Review accepts either a native Lexical-shaped review document directly or a WER interchange document through a validated adapter. The resulting authoring session treats that serialized input as immutable while session-local review state evolves through drafting and proposal resolution. Saving produces a successor native review document or WER interchange document rather than mutating or rebasing the input.
