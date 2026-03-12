---
"ovr": minor
---

feat(multipart): `Multipart.Part` now has a `value` method to get the `FormDataEntryValue` from the part.

```ts
for await (const part of new Multipart(req)) {
	const formDataEntryValue = await part.value(); // string | File
}
```
