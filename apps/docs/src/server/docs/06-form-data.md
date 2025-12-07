---
title: Form Data
description: How to handle user data with the built-in multipart form data parser.
---

## Multipart parser

When a user submits an [HTML form](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/form#enctype) with the `enctype="multipart/form-data"` attribute or creates a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#body) with form data, a multipart request is created that streams the information from the client to the server.

Instead of using [`Request.formData`](https://developer.mozilla.org/en-US/docs/Web/API/Request/formData) to buffer the entire request body in memory, ovr provides a streaming multipart parser to read the request body as it arrives in [chunks](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Transfer-Encoding#chunked).

- **Streaming** - Only one chunk is held in memory at a time to search for the boundary between parts. This allows the parser to handle massive file uploads without running out of memory.
- **Limit** - Configurable max `memory` (for chunk processing) and total `payload` size to prevent abuse.

## Usage

To stream parts of a multipart `Request`, use the `Multipart.parse` method. Each `Multipart.Part` yielded extends the web [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) object, so all of the methods such as `text()` and `bytes()` are available to use.

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

If you are using the parser within [middleware](/05-middleware), `Context.form` runs the parser on the current request.

```ts
import { Route } from "ovr";

const post = Route.post(async (c) => {
	for await (const part of c.form()) {
		// ...
	}
});
```

## Options

The parser comes with options for the maximum `memory` allocation and total `payload` size of the request body to prevent attackers from sending massive requests.

```ts
const options: Multipart.Options = {
	memory: 12 * 1024 * 1024, // increase to 12MB
	payload: 1024 ** 3, // increase to 1GB
};

// standalone
Multipart.parse(request, options);

// set options for the entire app
new App({ multipart: options });

// Context.form sets the options for the current request
c.form(options);
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
		for await (const part of c.form()) {
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
		for await (const part of c.form()) {
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

## Comparisons

### FormData

[`Request.formData`](https://developer.mozilla.org/en-US/docs/Web/API/Request/formData) is a built-in method to parse form data from any request, it **buffers all parts memory** when called. ovr's parser supports streaming and has memory and size guards to prevent abuse.

### Remix

[`@remix-run/multipart-parser`](https://github.com/remix-run/remix/tree/main/packages/multipart-parser) is a great option for multipart parsing, its [search function](https://github.com/remix-run/remix/blob/main/packages/multipart-parser/src/lib/buffer-search.ts) (Boyer-Moore-Horspool) has been adapted for use in ovr. It also depends on [`@remix-run/headers`](https://github.com/remix-run/remix/tree/main/packages/headers) which provides a rich API for accessing additional information about each part if needed.

Remix's incrementally **buffers each _part_ in memory** compared to ovr's incremental processing of each _chunk_. This makes it unable to stream extremely large files if your server cannot hold them in memory, and requires them to be fully buffered before forwarding to another server.

### SvelteKit

[SvelteKit's multipart parser](https://github.com/sveltejs/kit/pull/14775) is a full-stack solution to progressively enhance multipart submissions. It uses a [custom encoding](https://bsky.app/profile/rich-harris.dev/post/3m65ghxt4r22t) to stream files when client-side JavaScript is available. If you are using SvelteKit, it makes sense to use this parser, but it is **limited to using within SvelteKit applications**.

### Busboy

[`busboy`](https://github.com/mscdex/busboy) is the gold standard solution for multipart parsing in JavaScript. The primary difference from ovr is that busboy is **built for Node** and parses an `IncomingMessage` instead of a Fetch API `Request`.
