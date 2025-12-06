---
title: Data
description: How to handle user data with the built-in multipart form data parser.
---

## Multipart parser

When a user submits an [HTML form](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/form#enctype) with the `enctype="multipart/form-data"` attribute or creates a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#body) with form data, a multipart request is created that streams the information from the client to the server.

Instead of using [`Request.formData`](https://developer.mozilla.org/en-US/docs/Web/API/Request/formData) to buffer the entire request body in memory, ovr provides a streaming multipart parser to read the request body as it arrives in [chunks](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Transfer-Encoding#chunked).

## Memory

Only one chunk is held in memory at a time to identify the boundary between parts. This allows the parser to handle massive file uploads without running out of memory.

## Parse

To stream parts of a multipart `Request`, use the `Multipart.parse` method. Each `Multipart.Part` yielded from `data` extends the web [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) object, so all of the methods such as `text()` and `bytes()` are available to use.

```ts
import { upload } from "./upload";
import { Multipart } from "ovr";

// ...

for await (const part of Multipart.parse(request)) {
	part; // extends Response
	part.headers; // Headers
	part.body; // ReadableStream
	part.name; // form input name
	part.filename; // filename if available
	part.mime; // media type

	if (part.name === "name") {
		// buffer a text input
		const name = await part.text();
	} else if (part.name === "photo") {
		// stream an upload
		await upload(part.body);
	} else if (part.name === "doc") {
		// buffer bytes
		const bytes = await part.bytes();
	}
}
```

If you are using the parser within [middleware](/05-middleware), `Context.data` runs the parser on the current request.

```ts
import { Route } from "ovr";

const post = Route.post(async (c) => {
	for await (const part of c.data()) {
		// ...
	}
});
```

## Options

The parser comes with options for the maximum `memory` allocation and total `size` of the request body to prevent attackers from sending massive requests.

```ts
const options: Multipart.Options = {
	memory: 12 * 1024 * 1024, // increase to 12MB
	size: 1024 ** 3, // increase to 1GB
};

// standalone
Multipart.parse(request, options);

// set options for the entire app
new App({ multipart: options });

// Context.data sets the options for the current request
c.data(options);
```

## Examples

Other examples using the parser for file writes and within other frameworks.

### Node

Use ovr app on a Node server to stream a file to disk.

```ts
import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import { Route } from "ovr";

const upload = Route.post(async (c) => {
	try {
		for await (const part of c.data()) {
			if (part.name === "photo") {
				await part.body.pipeTo(
					Writable.toWeb(createWriteStream(`/uploads/${part.filename}`)),
				);
			}
		}

		c.text("Upload Complete", 201);
	} catch (error) {
		console.error(error);
		c.text("Upload Failed", 500);
	}
});
```

### Deno

Pass the `Part.body` directly to `Deno.writeFile`.

```ts
import { Route } from "ovr";

const upload = Route.post(async (c) => {
	try {
		for await (const part of c.data()) {
			if (part.name === "photo") {
				await Deno.writeFile(`/uploads/${part.filename}`, part.body);
			}
		}

		c.text("Upload Complete", 201);
	} catch (error) {
		console.error(error);
		c.text("Upload Failed", 500);
	}
});
```

### H3

```ts
import { H3 } from "h3";
import { Multipart } from "ovr";

const app = new H3();

app.post("/upload", async (event) => {
	for await (const part of Multipart.parse(event.req)) {
		// ...
	}
});
```

### Hono

```ts
import { Hono } from "hono";
import { Multipart } from "ovr";

const app = new Hono();

app.post("/upload", async (c) => {
	for await (const part of Multipart.parse(c.req.raw)) {
		// ...
	}
});
```
