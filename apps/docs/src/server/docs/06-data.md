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
	for await (const part of c.data()) {
		part; // extends Response
		part.name; // form input name
		part.filename; // filename if available
		part.mime; // media type
		part.headers; // Headers
		part.body; // ReadableStream

		if (part.name === "name") {
			const name = await part.text(); // buffer a text input
		} else if (part.name === "photo") {
			// stream part.body...
			// see examples below
		}
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

## Examples

### Node

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

### S3

```ts
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Route } from "ovr";

const s3 = new S3Client({ region: process.env.AWS_REGION });

const upload = Route.post(async (c) => {
	try {
		for await (const part of c.data()) {
			if (part.name === "photo") {
				await s3.send(
					new PutObjectCommand({
						Bucket: process.env.BUCKET_NAME,
						Key: part.filename,
						Body: part.body,
						ContentType: part.mime ?? "application/octet-stream",
					}),
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
