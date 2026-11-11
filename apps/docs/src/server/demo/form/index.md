---
title: Form
description: First class form validation with ovr.
---

`Schema` powers the fields and the route `Form` used below. This demo builds a typed multipart form, preserves opted-in invalid values through redirects, and streams the uploaded license file when validation succeeds.

```tsx
import { Field, Route } from "ovr";

export const enroll = Route.post("/demo/form")
	.fields({
		name: Field.text()
			.control({ placeholder: "Harry Potter" })
			.min(2, "Expected at least 2 characters")
			.persist(),
		email: Field.email()
			.control({ placeholder: "name@hogwarts.edu" })
			.refine(
				(v) => v.endsWith("@hogwarts.edu"),
				"Expected a @hogwarts.edu email",
			),
		house: Field.select([
			"Gryffindor",
			"Hufflepuff",
			"Ravenclaw",
			"Slytherin",
		]).persist(),
		wand: Field.radio([
			"Phoenix feather",
			"Dragon heartstring",
			"Unicorn hair",
		]).persist(),
		year: Field.number().min(1).max(7).persist(),
		pet: Field.checkboxes(["Owl", "Cat", "Toad"]).optional().persist(),
		arrival: Field.date().persist(),
		rules: Field.checkbox()
			.refine((v) => v, "You must accept the castle rules")
			.persist(),
		license: Field.file().stream(), // put `.stream()` last to parse fields first
	})
	.use(async (c) => {
		const result = await c.data();

		if (result.issues) return c.redirect(result.url, 303);

		if (result.stream) {
			for await (const part of result.stream) {
				// stream the uploaded file somewhere
				// await write(part.body);
			}
		}

		c.redirect(form, 303);
	});

export const form = Route.get("/demo/form").use((c) => (
	<enroll.Form state={c.url} />
));
```
