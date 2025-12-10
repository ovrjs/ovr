---
title: Form
description: Create a page and POST request handler with ovr.
---

This is a page and post route created with the [`Route.get` and `Route.post` methods](/04-route#get). The generated `<post.Form>` can be used directly within the page's markup.

```tsx
import { Route } from "ovr";

export const form = Route.get("/demo/form", (c) => {
	return (
		<post.Form>
			<div>
				<label for="name">Name</label>
				<input type="text" name="name" id="name" />
			</div>

			<button>Submit</button>
		</post.Form>
	);
});

export const post = Route.post(async (c) => {
	for await (const part of c.form()) {
		if (part.name === "name") {
			console.log(part);
		}
	}

	c.redirect("/", 303);
});
```
