---
"ovr": minor
---

Each line of `Field.textarea().lines()` is checked as the textarea checks its text, so `Field.textarea().max(80).lines()` limits each line, and its label, description, and control attributes are kept.
