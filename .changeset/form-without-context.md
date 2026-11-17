---
"ovr": minor
---

A route's form reads the request itself, so `route.form` takes no `c`, and the route's own `Form` shows a refused submission.

```tsx
// the simplest form now shows what was refused
<signup.Form />;

// to lay out the fields, or start from a record
const save = update.form(recipe);

<save.Form params={{ id }}>
	<save.Field name="title" />
	<button>Save</button>
</save.Form>;
```

- `route.form(values)` is not awaited and takes no `c`. Its `Form`, `Field`, and `Fields` are components, which read the request from the context they are rendered for.
- What a page reads outside of a component takes `c`: `await save.issues(c)`, `await save.values(c)`, and `await save.component(c, { name })`.
- `<route.Form />` returns a refused submission to the page it is on, with what was sent and what was wrong.
- Forms of one route on a page, such as one in every row, read what was refused once.
