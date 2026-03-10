---
title: Schema
description: First class form validation with ovr.
---

Use a `Schema` to generate an HTML `<form>` and validate the submitted data.

## Best practices

- Use css `text-transform: capitalize` for `<label>` and `<legend>` elements to prevent having to provide a custom `label` prop for each field.

```tsx
import { Route, Schema } from "ovr";

const student = Form.from({
	name: Field.text({ placeholder: "Harry Potter" }).refine(
		(v) => v.trim().length >= 2,
		"Expected at least 2 characters",
	),
	email: Field.email({ placeholder: "name@hogwarts.edu" }).refine(
		(v) => v.endsWith("@hogwarts.edu"),
		"Expected a @hogwarts.edu email",
	),
	house: Field.select(["Gryffindor", "Hufflepuff", "Ravenclaw", "Slytherin"]),
	wand: Field.radio(["Phoenix feather", "Dragon heartstring", "Unicorn hair"]),
	year: Field.number({ min: 1, max: 7 }).refine(
		(v) => v >= 1 && v <= 7,
		"Expected a year between 1 and 7",
	),
	pet: Field.checkboxes(["Owl", "Cat", "Toad"]),
	arrival: Field.date().transform((d) => d || "2026-09-01"),
	rules: Field.checkbox().refine((v) => v, "You must accept the castle rules"),
});

export const register = Route.post(student, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	// create new student record...

	c.redirect(schema, 303);
});

export const schema = Route.get("/demo/schema", (c) => (
	<register.Form state={c.url} />
));
```
