---
"ovr": minor
---

A route's form is bound to the request once, a refused submission is kept in a cookie in place of the URL, and every field keeps what was sent.

**`route.form(c, values)`** returns the route's form as the request sees it: `Form`, `Field`, `Fields`, `component`, and the `issues` and `values` of a refused submission. It replaces the `state` and `values` props, `route.Field`, `route.Fields`, `route.component()`, and `route.state()`.

```tsx
// before
<update.Form params={{ id }} state={c.url}>
	<update.Field name="title" values={post} state={c.url} />
	<button>Save</button>
</update.Form>;

// after
const save = await update.form(c, post);

<save.Form params={{ id }}>
	<save.Field name="title" />
	<button>Save</button>
</save.Form>;
```

- `save.component({ name })` is no longer awaited, and `save.issues` replaces `await route.state(c.url)`.
- A component that lays out fields for more than one route takes the form, typed `Field.Bound<typeof fields>`.
- A route's own `Form`, such as `<remove.Form params={{ id }} />`, is a plain form with a submit button. It no longer renders the route's fields.

**A refused submission is kept in a cookie.** It is compressed, lasts an hour, is sent only to the page the form is on, and cannot be read by a script. The redirect's address names it with a short ID, `?_form=3f9a2c1e`, so nothing a person typed is in an address, a history, or a log. A cookie holds a long form: a recipe of 100 ingredients with its steps and notes.

**`persist()` is removed.** Every field keeps what was sent, except a file and a password. Delete each `.persist()`.

**A GET form's state is its URL.** `route.form(c)` fills its fields from the search params and shows what is wrong with them once the URL has any. There is no `_form` for a GET form, and a GET route renders its form in place of redirecting to `result.url`.

**`auth.forms(c)` returns forms of the same shape:** `register`, `login`, `add`, `link`, and `logout`, each with a `Form`.

```tsx
// before
const { Register, Login } = auth.forms(c);

<Register>
	<Register.Field name="email" />
	<Register.Issue />
</Register>;
<Login />;

// after
const { register, login } = auth.forms(c);

<register.Form>
	<register.Field name="email" />
	<register.Issue />
</register.Form>;
<login.Form />;
```

`add.Form` returns to the page it is on, without a `state` prop.

`result.search` is removed from a refused result: redirect to `result.url`.
