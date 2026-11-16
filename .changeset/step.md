---
"ovr": minor
---

`step(n)` checks that a number is a multiple of `n`, such as halves or fives. A number or range field's control gets it as its `step`, so the browser checks it too, and the tool's JSON Schema gets `multipleOf`.

```ts
Field.number().min(0.5).max(5).step(0.5); // 0.5, 1, 1.5, to 5
```

It replaces `control({ step: 0.5 })` with a `refine` beside it. `step` is now a type error in a number or range field's `control()`, as `accept` and `pattern` are, since only the browser checked it there.
