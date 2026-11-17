---
"ovr": patch
---

A refused hidden field shows its issue, and its control is no longer marked.

A hidden field that failed rendered `aria-invalid`, `aria-describedby`, and `autofocus` on an input nobody can see or focus, and no message, so `aria-describedby` named an element that was not there. The control now has none of them, and the field's `Issue` renders the message.
