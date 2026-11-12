---
"ovr": patch
---

- A persisted `lines()` keeps each line of up to 512 characters, where before the whole text had that limit. The same goes for each value of a checkbox group or a select with `multiple()`.
- Attributes passed to a radio or checkbox group, such as `class` and `id`, are its fieldset's, as a list's are. Before, every box had them. Each box still has what `control()` set, and `required`.
- A radio or checkbox group's description follows its legend, before its options, as a list's does.
