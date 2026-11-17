---
"ovr": minor
---

`route.issues(c)` reads whether a submission to a route's form was refused, for the page around the form.

```tsx
const refused = await create.issues(c);

<details open={Boolean(refused)}>
	<create.Form />
</details>;
```

A fold that holds a form could only open on a refusal from inside the form's function, which put the `<details>` inside the `<form>`: a fold that also holds other forms can't do that, since forms don't nest, and styles written for the usual order broke. A route with parameters takes them as its form does, `update.issues(c, { id })`.
