---
"ovr": minor
---

`Field.lines()` is now `Field.textarea().lines()`: a textarea is text, and `lines()` takes it as a list of its lines. Each line is checked as the textarea checks its text, so `Field.textarea().max(80).lines()` limits each line, and its label, description, and control attributes are kept.
