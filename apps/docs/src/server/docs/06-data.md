---
title: Data
description: How to handle user data with the built-in multipart form data parser.
---

## Multipart parser

When a user submits an HTML form with the `enctype="multipart/form-data"` attribute, a multipart request is created that streams the information from the client to the server.

Instead of using `Request.formData` to buffer the entire request body in memory, ovr provides a streaming multipart parser to read the request body. `Context.data` runs the parser on the current request.

```ts
import { Route } from "ovr";

const post = Route.post(async (c) => {
	// authenticate...

	// stream file upload
	try {
		for await (const part of c.data()) {
			if (part.name === "photo") {
				await Bun.write(
					`/uploads/${part.filename}`,
					part, // extends Response
				);
			}
		}

		c.text("Upload Complete", 201);
	} catch (e) {
		console.error(e);
		c.text("Upload Failed", 500);
	}
});
```

Each `Multipart.Part` yielded from `data` extends the web [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) object, so all of the methods such as `text()` and `bytes()` are available to use.

## Options

The parser comes with options for the maximum `memory` allocation and total `size` of the request body to prevent attackers from sending massive requests.

```ts
const memory = 12 * 1024 * 1024; // increase to 12MB
const size = 1024 ** 3; // increase to 1GB

// set in App initialization
new App({ multipart: { memory, size } });

// or when you call the function
c.data({ memory, size });
```

## Standalone

The parser can also be used outside of the app context in other applications via the `Parser.data` method.

```ts
import { Hono } from "hono";
import { Multipart } from "ovr";

const app = new Hono();

app.post("/post", async (c) => {
	for await (const part of Multipart.parse(c.req.raw)) {
		// ...
	}
});
```
