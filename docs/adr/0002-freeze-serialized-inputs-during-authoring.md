# Freeze serialized inputs during authoring

An authoring session treats its input review document as immutable while review state evolves and pending revision proposals remain editable. Saving produces a successor review document without mutating or rebasing the input and without ending the authoring session. A review document contains current pending proposals only and does not retain accepted or rejected resolution history.
