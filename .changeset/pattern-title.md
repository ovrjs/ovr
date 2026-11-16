---
"ovr": patch
---

`pattern(source)` no longer needs a message. A browser shows the control's `title` when a value does not match, and that is now the field's hint, or its description, which already says what the value must be. The message is optional, as every other check's is, and is `Expected pattern …` by default.

```ts
Field.text()
	.hint("3 to 30 lowercase letters, numbers, or _")
	.pattern("[a-z0-9_]{3,30}");
```
