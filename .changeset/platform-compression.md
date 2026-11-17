---
"ovr": minor
---

A form's state is compressed with the platform's own `CompressionStream`, which makes it a third the length it was uncompressed: a recipe of 100 ingredients with its steps and notes is kept whole. Reading and writing the state is asynchronous now, so three calls are awaited:

```ts
const invalid = await result.invalid({ email: "Already registered" });
const refused = await create.state(c.url);
const Items = await save.component({ name: "ingredients", state: c.url });
```

`c.data()`, and the `Form`, `Field`, and `Fields` components, are used as before.
