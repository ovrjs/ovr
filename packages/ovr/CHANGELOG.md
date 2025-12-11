# ovr

## 6.0.1

### Patch Changes

- 60c2595: fix(multipart): Support other `multipart/*` types than just form data
- e2bb168: fix: Util type export issues

## 6.0.0

### Major Changes

- 3b6e581: remove!: Remove `Context.page`, `Context.head`, `Context.layouts`, and `Context.base`

  BREAKING CHANGES: ovr now expects the full page to be returned from each handler. This makes ovr more type safe and prevents bugs like forgetting to set the `head` elements on a page. Now wrap each page in a `Layout` component.

- 3b6e581: refactor(Render)!: Refactor `toGenerator`, `toStream`, and `toString` into a `Render` async iterable class.

  BREAKING CHANGES: Rendering functions are now all included within the `Render` class, `Chunk` methods are now also included here as well for everything to be accessible in one place.

  ```diff
  - import { toGenerator, toString, toStream, Chunk } from "ovr";
  + import { Render } from "ovr";

  - toGenerator(el);
  + new Render(el);

  - toStream(el);
  + Render.stream(el);

  - toString(el);
  + Render.string(el);

  - Chunk.safe(el);
  + Render.html(el);

  - Chunk.escape(el);
  + Render.escape(el);
  ```

- 3b6e581: refactor(context)!: Move `body`, `status`, and `headers` into a separate `res` object. Removes the `res` method.

  ```ts
  Route.get("/api/:id", (c) => {
  	c.res.body = "# Markdown"; // BodyInit | null | undefined
  	c.res.status = 200; // number | undefined
  	c.res.headers.set("content-type", "text/markdown; charset=utf-8"); // Headers
  });
  ```

- 3b6e581: refactor!: The same `Route` class is now used within the router and app. `Route` can now be used to create a route with any method.

  BREAKING CHANGES:
  - Makes router `Trie` class private
  - `Get` and `Post` helpers are now `Route.get` and `Route.post` respectively.
  - POST Route components (`<Form>`/`<Button>`) default to set `enctype=multipart/form-data`

  ```diff
  - import { Get, Post } from "ovr";
  + import { Route } from "ovr";

  - const page = new Get("/", () => {})
  + const page = Route.get("/", () => {})

  - const post = new Post(() => {})
  + const post = Route.post(() => {})

  + const route = new Route("DELETE", "/delete", () => {})
  ```

- 3b6e581: remove(memo)!: Removes `Memo` from the library.

  BREAKING CHANGE: See this [blog post](https://blog.robino.dev/posts/simple-memo) if you want to implement your own.

- 3b6e581: refactor(app)!: Merge `App.add` and `App.on/get/post` with `App.use`.

  `App.use` is now the single way to add middleware and routes to an app. Routes are now exclusively created using the `Route` class and then added to the app.

  ```ts
  import { App, type Middleware, Route } from "ovr";

  const app = new App();

  const mw: Middleware = (c, next) => {
  	console.log(c.req.method);
  	return next();
  };

  const route = Route.get("/", () => "hello world");

  app.use(mw, route);
  ```

  ```diff
  - app.get("/", () => {});
  + app.use(Route.get("/", () => {}));
  ```

### Minor Changes

- 3b6e581: feat: HEAD Request handling

  ovr now automatically handles [`HEAD`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/HEAD) requests, each will be routed to the corresponding `GET` route. Middleware will execute but `Context.res.body` will cleaned up and set to `null` before building the final response.

- 3b6e581: feat(Multipart): Adds streaming `Multipart` form data parser to handle large file uploads.

  [See documentation here](https://ovrjs.com/06-multipart)

- a6f763d: feat(Cookie): Adds `Context.cookie` class to easily get cookies from the current request headers, and set them on the response.

  ```ts
  import { Route } from "ovr";

  const route = Route.get("/", (c) => {
  	c.cookie.get(name);
  	c.cookie.set(name, value, options);
  });
  ```

### Patch Changes

- 3b6e581: fix: refactor `Route.Params` into a helper type to extract the params.

  This fixes an issue where `Route.Params` was interpreted as a runtime property instead of a type.

  ```diff
  import { Route } from "ovr";

  const page = Route.get("/:name", (c) => c.params.name);

  - type PageParams = typeof page.Params;
  + type PageParams = Route.Params<typeof page>;
  ```

## 5.0.0

### Major Changes

- 41b2c84: feat(jsx)!: prefix `<html>` opening tag with `<!doctype html>`.

  BREAKING CHANGE: If you were manually sending the doctype tag before, you no longer need to.

- 41b2c84: refactor(context)!: Refactor properties on `Context`

  BREAKING CHANGES:

  ### `head` and `layouts`

  Expose `layouts` and `head` directly instead of through helper methods. This provides greater control over which layouts are used for each handler. For example, you can `unshift` the root layout to remove it now instead of just appending.

  ```diff
  - c.layout(Layout);
  + c.layouts.push(Layout);
  ```

  ```diff
  - c.head(Layout);
  + c.head.push(Layout);
  ```

  ### `memo`

  `Context.memo` is now the actual `Memo` instance instead of a wrapper for `memo.use`.

  ```diff
  - c.memo(fn);
  + c.memo.use(fn);
  ```

- 41b2c84: refactor(app)!: Refactor properties between `App` and `Context`.

  BREAKING CHANGES:

  ### base

  Remove `App.base` in favor of setting `Context.base` and default to `""` instead of preset html template.

  If the default HTML template was being used, you will now need to set it instead. The default was rarely used, in most cases you either set your own, or send partials. So this change saves you from having to set it to the empty string before sending partials making it easier for HTMX users for example.

  To keep the old template default, set it within middleware:

  ```tsx
  import { App } from "ovr";

  const app = new App();

  app.use((c, next) => {
  	c.base =
  		'<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body></body></html>';

  	return next();
  });
  ```

  ### trailingSlash

  Trailing slash preference is now set in the `App` config instead of a property.

  ```diff
  + new App({ trailingSlash: "always" })
  - app.trailingSlash = "always"
  ```

  ### notFound

  Custom `notFound` handler is now set exclusively within `Context`, not on the `App`.

  ```diff
  const app = new App();

  const notFound = (c) => {
  	// ...
  };

  - app.notFound = notFound;
  + app.use((c, next) => {
  +	c.notFound = notFound;
  +	return next();
  + });
  ```

  ### error

  `error` has been removed in favor of using user middleware instead.

  ```diff
  const app = new App();

  const errorHandler = (c, error) => {
  	// ...
  };

  - app.error = errorHandler;
  + app.use(async (c, next) => {
  + 	try {
  +		await next();
  +	} catch (error) {
  +		errorHandler(c, error);
  +	}
  + });
  ```

- 41b2c84: refactor(app)!: Move to web standard APIs.

  ovr now runs more reliably in non-Node runtimes. This change removes reliance on `node:` built-in APIs, specifically `async_hooks` created [various issues](https://github.com/issues/created?issue=oven-sh%7Cbun%7C24199) across platforms.

  BREAKING CHANGES:

  ### Generator type

  Synchronous generators are now distinguished from other iterables by checking if they have a `next` property, instead of `util.types.isGeneratorObject`.

  ### Async Local Storage removal
  - Without `AsyncLocalStorage`, the `search` option within `Helper.url` and the `search` component prop no longer can take `true` as a value. You must pass in `Context.url.search` manually.
  - `Context.get` has been removed. You can implement the feature if needed, see below.

  ```tsx
  import { AsyncLocalStorage } from "node:async_hooks";
  import { App, type Context } from "ovr";

  const app = new App();

  const storage = new AsyncLocalStorage<Context>();

  /**
   * Call within the scope of a handler to get the current context.
   *
   * @returns `Request` context
   */
  const getContext = () => {
  	const c = App.storage.getStore();

  	if (!c)
  		throw new ReferenceError(
  			"Context can only be obtained within a handler.",
  		);

  	return c;
  };

  app.get("/", (c) => {
  	return storage.run(c, async () => {
  		return <Component />;
  	});
  });

  const Component = () => {
  	const c = getContext();
  	return <div>{c.url.pathname}</div>;
  };
  ```

- 41b2c84: feat(app)! Built-in basic CSRF protection.

  `csrf` middleware is now built in to `App` instead of a separate middleware. Set `options.csrf` to `false` to disable. If you were using the middleware, you can remove.

  In addition, the protection now checks the [`Sec-Fetch-Site`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) header and falls back to checking the `Origin`.

### Minor Changes

- 41b2c84: feat(app): Align `App.fetch` signature to `window.fetch`.

  The `App.fetch` method now has the same call signature as the standard [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch).

  In addition to inputting a `Request` to `App.fetch`, you can now input a `string` or `URL`. A second `options` parameter is also available to provide options to apply to the request.

  ```ts
  app.fetch(new Request("http://example.com"));

  // now these also work:
  app.fetch("http://example.com");

  const url = new URL("http://example.com");
  app.fetch(url);
  ```

### Patch Changes

- 41b2c84: fix(context): `Context.redirect` sets Response body to `null`
- 41b2c84: fix(context): Default `notFound` middleware sets `cache-control` to `no-cache`.

## 4.6.0

### Minor Changes

- 6935fc4: feat: Adds `Render.safe` method as an alias for `new Chunk(html, true)`.

### Patch Changes

- 6935fc4: perf: Use a time based strategy to yield back to the event loop instead of iterations for more consistent streaming for sync iterators. Other refactors and minor perf optimizations.

## 4.5.1

### Patch Changes

- 3e9cca7: types: add `command` attribute to `button`, add `closedby` attribute to `dialog`

## 4.5.0

### Minor Changes

- 3d77e9c: feat: Adds the `true` option to the `search` option in `Helper.url` and component props to forward the current requests search params.

  ```tsx
  import { Get } from "ovr";

  const page = new Get("/", () => {
  	// `search={true}` forwards the search params to the `href` attribute
  	return <page.Anchor search>Home</page.Anchor>;
  });
  ```

## 4.4.0

### Minor Changes

- 68ed951: feat: Adds [`Helper.url`](http://ovr.robino.dev/04-helpers#relative-url) to create a _relative_ URL for a route.
- 68ed951: feat: Adds [`search` and `hash` props](http://localhost:5173/04-helpers#props) to `Helper` components to append search params or a hash to the `href` or `action` accordingly.

### Patch Changes

- 68ed951: types: Add JSDoc to helper component props
- 68ed951: types: Add `number` type in addition to `string` for a variety of common HTML attributes (no runtime changes).

  For example, you can now pass a `number` directly to the `<input>`'s `value` attribute without getting a type error.

  ```diff
  - <input value={String(1)} />
  + <input value={1} />
  ```

## 4.3.0

### Minor Changes

- 46da501: feat: Add `toStream` helper function to create a `ReadableStream` from a `JSX.Element`.

## 4.2.7

### Patch Changes

- 363b93c: fix: `crossorigin` attribute should be `boolean` instead of `true`

## 4.2.6

### Patch Changes

- 5796b5d: fix: allow `crossorigin` boolean attribute

## 4.2.5

### Patch Changes

- 87fab37: fix: Adds `ResponseFinalized` errors to any properties of `Context` that cannot be set after the `Response` has been finalized.

## 4.2.4

### Patch Changes

- 6ad1ed2: fix: Better error handling for `Context.head`.

  If `Context.head` is called after the response is already being read, an error will be thrown since it will have no effect.

## 4.2.3

### Patch Changes

- 4e64d54: fix: Remove unneeded check from `Context.page`

## 4.2.2

### Patch Changes

- e801bee: patch: Removes undocumented support for `className` and `htmlFor` - if used, just use `class` and `for` respectively
- e801bee: perf: Update `toString` to use `Array.fromAsync`

## 4.2.1

### Patch Changes

- 2170567: perf: Stream optimizations

## 4.2.0

### Minor Changes

- a6e7dfc: feat: Add `pathname` and `Params` to helpers.

  Helpers have a two new properties.

  ```tsx
  const get = new Get("/hello/:name", (c) => <h1>Hello {c.params.name}</h1>);
  ```

  ### Params

  `Params` is a type helper to get the specific params of the route based on the pattern.

  ```ts
  typeof get.Params; // { name: string }
  ```

  ### Pathname

  The `pathname` method inserts params into the pattern. It provides type safety to ensure you always pass the correct params (or no params) to create the pathname.

  ```ts
  get.pathname({ name: "world" }); // `/hello/${string}`
  get.pathname({ name: "world" } as const); // "/hello/world"
  ```

  Using incorrect params results in an error:

  ```ts
  get.pathname({ id: "world" });
  // Error: 'id' does not exist in type '{ name: string; }'
  ```

  You can even create a list of exact pathnames for given params.

  ```ts
  const params = [
  	{ name: "world" },
  	{ name: "ross" },
  ] as const satisfies (typeof get.Params)[];

  const pathnames = params.map((p) => get.pathname(p));

  // ("/hello/world" | "/hello/ross")[]
  ```

### Patch Changes

- a6e7dfc: chore: Refactor helpers to extend a shared `Helper` class.

## 4.1.1

### Patch Changes

- 686ebc3: perf: minor performance improvements

## 4.1.0

### Minor Changes

- 5e53fc6: feat: Adds [more components](https://ovr.robino.dev/04-helpers) to `Get` and `Post` helpers.

## 4.0.0

### Major Changes

- 4aa4ae5: rename: Renames `Page` and `Action` helpers to `Get` and `Post` respectively.

### Minor Changes

- 4aa4ae5: feat: Allow empty `app.base` to return HTML partials

### Patch Changes

- 4aa4ae5: fix: yield with `setImmediate` every 50 iterations to properly cancel request for sync generators.
- 4aa4ae5: fix: memory leak in `merge` with promise that never resolved

## 3.0.1

### Patch Changes

- 5a757b5: publish source and declaration maps for go to definition
- 22b88a2: fix: Adds better JSDoc and types for `jsx` function.
- b5ebc6c: fix: single falsy child not being rendered

  For example:

  ```tsx
  <div>{0}</div>
  ```

  Was not rendering. Now it correctly produces `"<div>0</div>"`

## 3.0.0

### Major Changes

- 7c5a307: feat: Escape content and attributes automatically.

  This fixes one of the major shortcomings of ovr, previously it did not automatically escape content or attribute strings. Now ovr will automatically escape any children and attribute content.

  `jsx` and `toGenerator` now are `AsyncGenerator<Chunk>` instead of `AsyncGenerator<string>`. When a `Chunk` is created, its `value` is escaped by default.

  Now, to render HTML directly without escaping, create a new `Chunk` with the second argument `safe` set to `true`.

  ```tsx
  import { Chunk } from "ovr";

  const html = "<p>Safe to render</p>";

  function Component() {
  	return <div>{new Chunk(html, true)}</div>;
  }
  ```

- 7c5a307: breaking: `escape` is now a static method of the `Chunk` class

## 2.1.0

### Minor Changes

- bfbf643: feat: add CSRF middleware

## 2.0.4

### Patch Changes

- c41f753: fix: better error handling for streams

## 2.0.3

### Patch Changes

- f01c132: fix: Prevent event loop blocking during large HTML generation

  Added periodic event loop yielding to prevent blocking when generating large amounts of HTML. This ensures streaming chunks are properly flushed to the browser even when processing thousands of elements.

  Previously, generating large HTML structures (like tables with many rows) could block the event loop, causing the browser to stop receiving chunks mid-stream. The page would appear to load partially then hang, especially noticeable with datasets over 1000+ items.

  Now ovr automatically yields control back to the event loop periodically, allowing the streaming response to flush chunks consistently throughout the generation process.

- f01c132: fix: Prevent memory buildup when rendering large sync generators

  When a synchronous generator function is encountered, ovr now processes and streams each yielded element individually instead of collecting all values into memory first. This prevents memory exhaustion when rendering large datasets like tables with thousands of rows.

  ```tsx
  const Component = () => {
  	return (
  		<div>
  			{function* () {
  				for (const item of items) {
  					yield <Item item={item} />;
  				}
  			}}
  		</div>
  	);
  };
  ```

  Previously, a generator yielding 10,000 JSX elements would create all 10,000 objects in memory before streaming began. Now each element is processed and streamed immediately, keeping memory usage constant regardless of dataset size.

  Users can still choose arrays when parallel processing is important than memory efficiency.

  ```tsx
  const Component = () => {
  	return (
  		<div>
  			{items.map((item) => (
  				<Item item={item} />
  			))}
  		</div>
  	);
  };
  ```

## 2.0.2

### Patch Changes

- 16621f3: fix: autocomplete other attributes for Action.Form and Page.Anchor
- 492dbc5: add `webkitdirectory` attribute to input element type

## 2.0.1

### Patch Changes

- 678d183: fix: don't yield empty strings

## 2.0.0

### Major Changes

- b32c519: Changes `context()` to a static `get` method on `Context`
- 772afad: removes `app.mount`

  There were many features not supported when mounting a router to another. May revisit at some point.

- 2d11a81: Moves `App` config out of the constructor to top level properties that are passed through to `Context`.
- dc1425b: Removes `start`/`c.state` to simplify the API.

  Use `app.use` to run global middleware instead.

- 5642431: feat: Return `JSX.Element` or a `Response` from middleware

  This is breaking, if you were returning something random from middleware before it will now be used.

- bd8a561: Removes `Suspense` component - too hacky to use this css only implementation.
- 78055a1: Renames `Router` to `App`

### Minor Changes

- 9edb66b: feat: add `Memo` - `context.memo` will memoize functions per request. Or use independently with `Memo.use`.
- 031942e: feat: adds `Page` and `Action` helpers, and `app.add` register

### Patch Changes

- bd8a561: fix: only inject extra `<div>` for safari streaming bug if UA is safari

## 1.4.0

### Minor Changes

- 893f441: feat: add `context` async local storage function to get the context anywhere.

## 1.3.0

### Minor Changes

- a97873a: feat: use multiple methods with `on`

## 1.2.4

### Patch Changes

- 7093dbe: intrinsic element interface

## 1.2.3

### Patch Changes

- 455e4cd: fix: text headers

## 1.2.2

### Patch Changes

- 39bb91e: types: update `popover` attr type

## 1.2.1

### Patch Changes

- b72bd26: fix: `true` should not render instead of rendering `"true"`

## 1.2.0

### Minor Changes

- 926b0a7: feat: `Router.use` method to add global middleware

## 1.1.0

### Minor Changes

- 2651306: feat: add `Suspense` component - CSS only fallback loader for in-order streaming

### Patch Changes

- 0c92714: fix: safari streaming bug workaround
  - https://bugs.webkit.org/show_bug.cgi?id=252413
  - https://github.com/sveltejs/kit/issues/10315

- 091f36a: fix: type for void elements

  Omitting `children` broke attribute types, now `children = undefined` for void elements.

## 1.0.0

### Major Changes

- a99b756: release v1

## 0.1.1

### Patch Changes

- 435547a: allow other properties on the router

## 0.1.0

### Minor Changes

- 284a03f: release 0.1
