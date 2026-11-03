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

The `App` API is inspired by and works similar to frameworks such as [Express](http://expressjs.com), [Koa](https://koajs.com), and [Hono](https://hono.dev/).

## Options

The following values can be configured when creating the `App`.

### Trailing Slash

ovr handles [trailing slash](https://bjornlu.com/blog/trailing-slash-for-frameworks) redirects automatically, you can customize the redirect preference.

```ts
new App({ trailingSlash: "always" });
```

### CSRF

ovr comes with basic [cross-site request forgery](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF) protection. Requests other than `GET` and `HEAD` must come from the same origin, by their `Sec-Fetch-Site` or `Origin` header. Browsers send at least one of these, so a request with neither and without cookies is from another kind of client, such as an [agent](/10-agents), and is allowed.

```ts
new App({ csrf: false }); // disables the built-in protection
```

### Form

[Multipart form data options](/06-multipart#options).

```ts
new App({
	form: {
		memory: 12 * 1024 ** 2, // increase to 12MB
		payload: 1024 ** 3, // increase to 1GB
		parts: 4, // only accept up to 4 parts
	},
});
```

## Use

_Use_ the `use` method to register [routes](/04-route) and [middleware](/05-middleware) to your application.

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

`use` also mounts services. An [Auth service](/08-auth) adds its registration, login, logout, and browser endpoints, and an [MCP endpoint](/10-agents) adds the route agents connect to.

```ts
app.use(auth, mcp);
```

## Fetch

Use the `fetch` method to create a `Response`, this is the `Request` handler for your application.

```ts
const response = await app.fetch("https://example.com");
```

### Client IP

Server adapters can pass a trusted client IP with `app.fetch(request, { ip })`. It becomes `c.ip` for [rate limiting](/05-middleware#rate-limiting) and [authentication](/08-auth). A standard Fetch `Request` cannot identify its socket peer, so your server must supply this metadata. Passing only `ip` preserves the original `Request` object; normal `RequestInit` options such as `method` and `headers` remain available in the same argument.

For a Node server with [srvx](https://srvx.h3.dev/guide/handler), use the connection's address:

```ts
import { serve } from "srvx";

serve({ fetch: (request) => app.fetch(request, { ip: request.ip }) });
```

Behind a reverse proxy, the socket peer identifies the proxy. Accept connections only from your proxy and use a client header that it overwrites. Passing the proxy's address makes all users share one rate-limit bucket.

For a Cloudflare Worker reached through its Internet-facing edge, with Worker subrequests blocked by your edge policy:

```ts
export default {
	fetch(request: Request) {
		const ip = request.headers.get("CF-Connecting-IP");
		return app.fetch(request, ip ? { ip } : {});
	},
};
```

Cloudflare supplies that identity at its edge. Same-zone Worker subrequests can reflect a caller-modified `x-real-ip`; cross-zone subrequests use a fixed address. If those callers are allowed, use an authenticated identity policy instead. Cloudflare documents blocking Worker subrequests with `cf.worker.upstream_zone`. [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [blocking Worker subrequests](https://developers.cloudflare.com/waf/custom-rules/use-cases/block-worker-subrequests/).

Never copy an arbitrary forwarded header into `ip`. Missing or invalid identity denies rate-limited requests; it does not disable the limiter.

## Head requests

ovr automatically handles [`HEAD`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/HEAD) requests, each will be routed to the corresponding `GET` route. Middleware will execute but `Context.res.body` will cleaned up and set to `null` before building the final response.
