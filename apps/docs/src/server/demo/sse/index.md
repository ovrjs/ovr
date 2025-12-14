---
title: Server Sent Events
description: How to create server sent events using generator functions.
---

Create a [server sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) stream using a generator function.

```ts
import { Route } from "ovr";

// simulate latency
const delay = () => new Promise((r) => setTimeout(r, 300));

const sse = Route.get("/sse", (c) => {
	// set the content-type header to create a SSE
	c.res.headers.set("content-type", "text/event-stream");

	// passed into `render.stream`
	return async function* () {
		yield "data: server\n\n";
		await delay();
		yield "data: sent\n\n";
		await delay();
		yield "data: event\n\n";
	};
});
```
