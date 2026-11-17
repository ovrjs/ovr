---
title: App
description: Creating an application with ovr.
---

## Create

To create a web server with ovr, initialize a new `App` instance:

```ts
import { App } from "ovr";

const app = new App();
```

## Options

The following values can be configured when creating the `App`.

### Trailing slash

When no route matches a path, ovr tries it with the [trailing slash](https://bjornlu.com/blog/trailing-slash-for-frameworks) added or removed, and redirects there with a `308` if that matches. `trailingSlash` sets which form the redirect goes to:

| Value               | A request that matches no route                  |
| ------------------- | ------------------------------------------------ |
| `"never"` (default) | `/about/` redirects to `/about`                  |
| `"always"`          | `/about` redirects to `/about/`                  |
| `"ignore"`          | No redirect, so each form is a different address |

```ts
new App({ trailingSlash: "always" });
```

A route that matches always answers, so `/style.css` works in every mode.

### CSRF

ovr comes with basic [cross-site request forgery](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF) protection. Requests other than `GET` and `HEAD` must come from the same origin, by their `Sec-Fetch-Site` or `Origin` header. Browsers send at least one of these, so a request with neither and without cookies is from another kind of client, such as an [agent](/agents), and is allowed.

```ts
new App({ csrf: false }); // disables the built-in protection
```

### Multipart

[Multipart form data options](/multipart#options): `memory`, 4MB by default, is the most the parser holds at once, and also the largest request the [MCP endpoint](/agents#tools) reads; `payload`, 16MB by default, is the largest body; and `parts` has no limit unless you set one.

```ts
new App({
	multipart: {
		memory: 12 * 1024 ** 2, // increase to 12MB
		payload: 1024 ** 3, // increase to 1GB
		parts: 4, // only accept up to 4 parts
	},
});
```

## Use

_Use_ the `use` method to register [routes](/route) and [middleware](/middleware) to your application.

```tsx
app.use(page); // single
app.use(page, login, mw); // multiple
app.use({ page, login, mw }); // object
app.use([page, login, mw]); // array
// any combination of these also works
```

This makes it easy to create a module of routes and/or middleware,

```tsx
// home.tsx
import { Route } from "ovr";

export const page = Route.get("/").use((c) => {
	// ...
});

export const login = Route.post("/login").use((c) => {
	// ...
});
```

and then use them all at once:

```tsx
// app.tsx
import * as home from "./home";

app.use(home); // uses all exports
```

`use` also mounts services. An [Auth service](/auth) adds its registration, login, logout, and browser endpoints, and an [MCP endpoint](/agents) adds the route agents connect to.

```ts
app.use(auth, mcp);
```

## Fetch

Use the `fetch` method to create a `Response`, this is the `Request` handler for your application.

```ts
const response = await app.fetch("https://example.com");
```

### Client IP

A `Request` doesn't say who sent it, so the server passes the client's IP: `app.fetch(request, { ip })`. It becomes `c.ip`, which [rate limiting](/middleware#rate-limiting) and [Auth](/auth) count by.

```ts
// Node, with srvx
serve({ fetch: (request) => app.fetch(request, { ip: request.ip }) });

// a Cloudflare Worker
export default {
	fetch(request: Request) {
		const ip = request.headers.get("CF-Connecting-IP");
		return app.fetch(request, ip ? { ip } : {});
	},
};
```

Behind a reverse proxy the connection's address is the proxy's, and passing it would put every user in one rate-limit bucket. Accept connections only from the proxy, and take the IP from a header the proxy overwrites.

A proxy that ends TLS also hands the server an `http` URL. Give `app.fetch` the request with its public URL, since [Auth](/auth#deployment) compares each request's origin with its own:

```ts
serve({
	fetch: (request) => {
		const url = new URL(request.url);
		url.protocol = "https:";

		return app.fetch(new Request(url, request), { ip: request.ip });
	},
});
```
