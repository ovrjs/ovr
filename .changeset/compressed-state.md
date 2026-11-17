---
"ovr": minor
---

A form's state is compressed in the URL, so a long form keeps what was typed when a submission is refused. A recipe of 50 ingredients with its steps and notes is kept whole, where 20 ingredients lost the steps and the notes. A single value is no longer limited to 512 characters. The state is at most 5 KB in the URL, shorter than before for a form that already fit, and values are still left out from the last field back when it is larger.

Nothing changes in an app: fields opt in with `persist()` as before. A URL with state from an earlier version is ignored.
