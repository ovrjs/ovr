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

ovr comes with basic [cross-site request forgery](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF) protection.

```ts
new App({ csrf: false }); // disables the built-in protection
```

### Form

[Multipart form data options](/06-form-data#options).

```ts
new App({
	form: {
		memory: 12 * 1024 * 1024, // increase to 12MB
		payload: 1024 ** 3, // increase to 1GB
	},
});
```

## Use

_Use_ the `use` method to register [routes](/04-route) and [middleware](/05-middleware) to your application.

```tsx
app.add(page); // single
app.add(page, login, mw); // multiple
app.add({ page, login, mw }); // object
app.add([page, login, mw]); // array
// any combination of these also works
```

This makes it easy to create a module of routes and/or middleware,

```tsx
// home.tsx
import { Route } from "ovr";

export const page = Route.get("/", (c) => {
	// ...
});

export const login = Route.post((c) => {
	// ...
});
```

and then add them all at once:

```tsx
// app.tsx
import * as home from "./home";

app.add(home); // adds all exports
```

## Fetch

Use the `fetch` method to create a `Response`, this is the `Request` handler for your application.

```ts
const response = await app.fetch("https://example.com");
```

## Head requests

ovr automatically handles [`HEAD`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/HEAD) requests, each will be routed to the corresponding `GET` route. Middleware will execute but `Context.res.body` will cleaned up and set to `null` before building the final response.
