---
"ovr": major
---

refactor(Render)!: Refactor `toGenerator`, `toStream`, and `toString` into a `Render` async iterable class.

BREAKING CHANGES: Rendering functions are now all included within the `Render` class, `Chunk` methods are now also included here as well for everything to be accessible in one place.

```diff
- import { toGenerator, toString, toStream, Chunk } from "ovr";
+ import { Render } from "ovr";

- toGenerator(el);
+ new Render(el);

- toStream(el);
+ Render.stream(el);

- toString(el);
+ Render.string(el);

- Chunk.safe(el);
+ Render.html(el);

- Chunk.escape(el);
+ Render.escape(el);
```
