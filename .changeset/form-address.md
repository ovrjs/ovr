---
"ovr": minor
---

A refused submission is shown only by the form it was sent to, and a form takes its route's parameters where it is made.

```tsx
const save = update.form(recipe, { id });

<save.Form>
	<save.Field name="title" />
	<button>Save</button>
</save.Form>;
```

- **Fixed:** a refused submission was shown by every form on the page with the same field names, such as the one in each row of a list, or another route's. Someone who corrected the first form they saw could save one record's edit into another. What is kept now names the form it was sent to.
- `route.form(values, params)` takes the pattern's parameters, and its `Form` takes no `params`. Leaving them out for a route that has them is a type error. A form that starts empty is `route.form(undefined, params)`.
- `Form`, `Field`, and `Fields` are components: calling one as a function, which lost the request with no error, is a type error.
- A component whose context is typed with a route's parameters, such as `c: Context<{ id: string }>`, is no longer accepted as a tag, since it can be rendered on any page.
- A form that posts to the address of the page it is on has no `_return` in its action, since a refusal returns there already.
- The cookie that keeps a refused submission has a new format, so one kept before this version is not shown.
