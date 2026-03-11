---
title: Schema
description: First class form validation with ovr.
---

`Schema` is modeled after [Zod](https://zod.dev/) and powers the `Field` and `Form` helpers used below. This demo builds a typed multipart form, preserves invalid values through redirects, and streams the uploaded license file when validation succeeds.

```tsx
import { Field, Form, Route } from "ovr";

const student = Form.from({
	name: Field.text({ placeholder: "Harry Potter" }).min(
		2,
		"Expected at least 2 characters",
	),
	email: Field.email({ placeholder: "name@hogwarts.edu" }).refine(
		(v) => v.endsWith("@hogwarts.edu"),
		"Expected a @hogwarts.edu email",
	),
	house: Field.select(["Gryffindor", "Hufflepuff", "Ravenclaw", "Slytherin"]),
	wand: Field.radio(["Phoenix feather", "Dragon heartstring", "Unicorn hair"]),
	year: Field.number().min(1).max(7),
	pet: Field.checkboxes(["Owl", "Cat", "Toad"]),
	arrival: Field.date().transform((d) => d || "2026-09-01"),
	rules: Field.checkbox().refine((v) => v, "You must accept the castle rules"),
	license: Field.file().stream(), // put `.stream()` last to parse fields first
});

export const enroll = Route.post(student, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	if (result.stream) {
		for await (const part of result.stream) {
			// stream the uploaded file somewhere
			// await write(part.body);
		}
	}

	c.redirect(schema, 303);
});

export const schema = Route.get("/demo/schema", (c) => (
	<enroll.Form state={c.url} />
));
```
