---
"ovr": minor
---

A route's `Form` takes `values`, and a function child that lays out its fields. `route.form()` is removed.

```tsx
<update.Form params={{ id }} values={post} />

<update.Form params={{ id }} values={post}>
	{(form) => (
		<>
			<form.Field name="title" />
			<button>Save</button>
		</>
	)}
</update.Form>
```

- There is one way to make a form: the route's `Form`. `values` fills its fields, and `params` is on the tag as it is for any route.
- A function child is given the form's parts: `Field`, `Fields`, `component({ name })`, `issues`, and `values`. They are plain again, with no `c` and nothing to await, since the form has read the request before it calls the function.
- To act on a refusal outside the fields, such as opening a `<details>`, put it inside the form's function, where `form.issues` is.
