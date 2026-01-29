---
title: Schema
description: First class form validation with ovr.
---

Use a `Schema` to generate an HTML `<form>` and validate the submitted data.

```tsx
import { Route, Schema } from "ovr";

export const create = Route.post(
	{
		username: Schema.Field.text(),
		email: Schema.Field.email(),
		age: Schema.Field.number(),
		house: Schema.Field.select([
			"Gryffindor",
			"Hufflepuff",
			"Ravenclaw",
			"Slytherin",
		]),
	},
	async (c) => {
		const data = await c.data();

		return c.redirect(page, 303);
	},
);

export const page = Route.get("/register", (c) => {
	return <create.Form />;
});
```
