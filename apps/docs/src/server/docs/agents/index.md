---
title: Agents
description: Pages as Markdown, routes as MCP tools, and forms as WebMCP tools, so AI agents can use your app.
---

An ovr app works for AI agents the same way it works for people. Pages render as Markdown for agents that ask for it, an [MCP](https://modelcontextprotocol.io) endpoint turns your routes into tools, and forms are tools for agents in the browser. With [Auth](/auth#agents), the user approves the agent with their passkey and the agent acts as that user, through the same handlers.

## Markdown

A request with `Accept: text/markdown` gets the page as Markdown. Nothing changes in your routes: the same JSX renders as Markdown instead of HTML, writing each block as soon as it is complete.

```bash
curl -H "Accept: text/markdown" https://example.com/posts
```

```md
# Posts

- [Hello world](https://example.com/posts/1)

**Form:** `POST https://example.com/posts` as `multipart/form-data`

- Title `title` (text, required)

Submit: Create post
```

- When the page has a `<main>` element, only its contents are written, leaving out the navigation and footer. A page without one is written when it ends instead of block by block.
- Links and images are absolute, so an agent can follow them.
- Forms are described by where they submit and how to encode the body, their fields with types, rules such as `required`, choices, and current values, and errors from a failed submission. A form in a table's cell that is only a button, such as a delete in each row, is written in the cell as ``Delete: `POST https://example.com/posts/1/delete` ``. One with fields is written after the table. A form around a table, such as one with a checkbox in each row, keeps the table, with each control named in its cell as `` `ids=1` ``.
- Scripts, styles, and elements with `hidden` or `aria-hidden="true"` are left out. `<noscript>` content is kept, since agents do not run scripts.
- Raw markup from `Markup.raw` is written as it is, since Markdown can contain HTML, and `Markdown.raw(markdown, html)` is written as its Markdown source.

To render Markdown yourself, such as part of a page, use [`Markdown`](/render#markdown).

Browsers get HTML: Markdown is only used when it is listed in `Accept` and preferred at least as much as HTML. These responses include `Vary: Accept` for caches. Responses with another content type, such as XML, are not converted. A page served from a static file, such as a prerendered one, never reaches the app, so it is always HTML.

### Markdown source

A page that is a Markdown document, such as a blog post or a docs page, can give agents its source instead. Its HTML from a Markdown processor, with highlighted code, is often several times longer.

```tsx
const post = Route.get("/posts/:slug").use(async (c) => {
	const post = await posts.get(c.params.slug);

	if (c.md(post.markdown)) return;

	return <Post html={post.html} />;
});
```

`c.md(body, status)` responds with the Markdown and returns `true` when the request asks for Markdown, otherwise it returns `false` and the page renders for the browser. It runs in the handler, after the route's middleware, such as a sign-in check.

## MCP

Add an `Mcp` endpoint to the app. Agents connect to `/mcp`.

```ts
import { App, Mcp } from "ovr";

const mcp = new Mcp({
	name: "posts",
	instructions: "Write and manage the user's blog posts.",
});

app.use(mcp);
```

| Option         | Default        | Purpose                                                     |
| -------------- | -------------- | ----------------------------------------------------------- |
| `name`         | The app's host | Server name shown in clients                                |
| `instructions` | None           | Guidance for agents on how to use the app                   |
| `path`         | `/mcp`         | Endpoint path, a fixed path of the app's own                |
| `auth`         | None           | `Auth` service agents sign in with, see [Sign in](#sign-in) |

### Tools

Only [described routes](/route#describe) are served to agents, so adding a route never lets agents call or read it. Write the description for an agent that sees the route without your UI:

```ts
const create = Route.post("/posts")
	.describe("Create a blog post")
	.fields({ title, body })
	.use(handler);

const remove = Route.post("/posts/:id/delete")
	.describe("Delete a post permanently")
	.params({ id: Schema.string().uuid() })
	.use(handler);
```

| Route                             | Agents get                       |
| --------------------------------- | -------------------------------- |
| POST and other methods, described | A tool                           |
| GET, described                    | A read-only tool, and a resource |
| Not described                     | Nothing through MCP              |

A tool's input schema combines the pattern's parameters, converted by `params` schemas, and the route's `fields`. A field's `label` is its `title`, so a terse name such as `dob` still reads as "Date of birth", what it is given with [`describe`](/schema#post-forms) is its `description`, and an unchecked `Field.checkbox()` may be left out, as browsers do. A file field takes the file's `name`, an optional media `type`, and its contents as `text`, or as `base64` when it is not text, such as `{ "name": "notes.txt", "text": "..." }`. A field made with `.json(schema)` takes the value its schema describes, such as an array of ingredients, and the route receives it as the JSON text a form would send. `Field.textarea().lines()` takes an array of strings and `Field.list()` an array of its items, each an object of its fields when it has several, where a person fills a textarea's lines or a row for each. The page of an edit form shows the current items as that array, and leaves out a table that only lays out the list's rows. The call's request is read into memory, so it is limited by the app's [`multipart.memory`](/app#multipart), 4MB by default. A date, time, date and time, month, week, or color field adds the format its picker sends to its description, such as `Birthday. Date as YYYY-MM-DD.` A parameter its `params` schema rejects, such as an ID that is not a UUID, is returned to the agent as an issue, like a form's, where a browser would get a 404. A form's tool takes only its fields and parameters, so an argument it does not have is an issue naming it. A route without fields is left open, since its handler may read the query or the body itself. A `*` wildcard is the `wildcard` argument, so describing a pattern with both `:wildcard` and `*` is a type error. Its name is generated from the method and pattern, for example `post_posts_id_delete`.

A tool call is a request to the route. The arguments become form data, or search parameters for GET, and the response is returned as Markdown, following redirects to described pages. The endpoint itself is outside your app's [global middleware](/middleware#composition): the request it makes to the route is the one that passes through it, once, like a person's request to the same route. A response that is not text is returned as a file, as a person would see or download it: an image or audio as `image` or `audio` content, and any other type, such as a PDF, as an embedded resource with its `blob`. A response over 4MB is the protocol's internal error, `Response too large`. An event stream may never end, so the agent gets its address instead, to open itself, read as the events arrive, and close when it has enough. With `auth` the address is for the user to open in their browser. A redirect to another site returns its URL, such as a checkout page for the user to open. A redirect to a page of the app agents cannot read returns only that it redirected, keeping its address and any token in it private. To give an agent a link, such as a share link, describe the page it redirects to, or respond with the link instead of redirecting. When `c.data()` finds issues, the agent receives them as an error with each field's message, instead of a redirect back to the form. A response the agent can act on, such as a 403 or a 404, is returned as an error result with its text, or for a resource as an error about the request, and a rate limit's with when to retry. A write that redirects is done: if the page it redirects to cannot be read, the result says so without being an error, so the agent does not make the write again. A server error, a status of 500 or more, is the app's to fix, so the agent receives the protocol's internal error, -32603 with the status in its `data`, and not your error page. A resource the app refuses, such as with a 403, is -32602 with its `uri` and `status`, and a missing one is -32602 `Resource not found`, or -32002 for a client on a 2025 version, the code those versions use. That needs your app to [catch its errors](/middleware#not-found-and-errors): one that nothing catches leaves `app.fetch`, as from any route. Your handlers do not change.

A client may state the user's language. The route receives it as `Accept-Language`, as a person's browser sends it, and the `Content-Language` the route answers with is reported back to the client.

Pages an agent reads through MCP give each form as the call to its tool, with the arguments the form's address holds, such as a delete beside each item:

```md
- [ovr](https://ovrjs.com/)
  Delete ovr: tool `post_bookmarks_id_delete`, `id`: `0b8f5d0a`
```

A form with current values or messages, such as an edit form, lists them under the tool's name, since the tool's input schema already describes its fields. Choices given as the page renders, such as a record's own photos, are listed there too, since the schema can't hold them. A single checkbox's value is `true` or `false`, like its argument. A form that submits to a route you have not described is left out, as the agent has no tool to submit it with. Pages requested as Markdown outside MCP describe every form, with its address and fields.

`route.tool` is the name and description a route is called with, and whether it only reads, or `undefined` when it is not a tool. Names of patterns with `_` or other punctuation, or longer than 64 characters, end with a short hash of the pattern, so `/a/b` and `/a_b` get different names. Two routes cannot share a name: `app.use()` throws when they would, such as for a parameter and a segment with the same text, like `/drafts/:id` and `/drafts/id`, so you find out when the app starts.

### Resources

Described GET routes are resources. Routes without parameters are listed; routes with parameters are templates, like `https://example.com/posts/{id}`. Reading one renders the page as Markdown.

A resource is named by its address, which an agent may also fetch itself. With [`auth`](#sign-in), the address needs the user's session, so the page is named `page://example.com/posts/{id}` instead and read through the endpoint. Links inside a page stay real addresses, for the user to open, and reading one by its address works too.

### Sign in

Pass `auth` to require agents to sign in. The user approves the agent once in the browser, and its tool calls then act as that user: `c.session()` returns their session. Global middleware sees that session too, on the request the endpoint makes to your route, so a [limiter](/middleware#rate-limiting) that counts each user counts an agent's calls for its user. The endpoints an agent signs in through, the OAuth metadata documents, `/oauth/authorize`, and `/oauth/token`, are outside global middleware too, like the MCP endpoint, so a check for a session there does not turn an agent away before it has signed in. Your consent page and its approve and deny posts are the signed-in user's own requests, and pass through global middleware as usual. Your login page is the one page such a check has to leave open, as it does for people.

```ts
const mcp = new Mcp({ instructions: "...", auth });
```

The endpoint also mounts Auth's OAuth endpoints, and serves the protected resource metadata agents use to find them. Write the page where users approve agents at `/connect`, see [Auth agents](/auth#agents).

### Connect an agent

Point an MCP client at the endpoint:

```bash
claude mcp add --transport http posts https://example.com/mcp
```

With `auth`, the agent opens your sign-in page in the browser, then your consent page, and returns once the user allows it. To sign in to an app running locally, connect to its HTTPS address, such as `https://localhost:5173/mcp`. A command-line agent built on Node.js may not trust your local certificate the way your browser does; set `NODE_EXTRA_CA_CERTS` to the certificate's file, or its certificate authority's, when you start it.

To see what an agent gets, connect one to these docs, which are an ovr app with an MCP endpoint:

```bash
claude mcp add --transport http ovr https://ovrjs.com/mcp
```

### Protocol

The endpoint implements the [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) Streamable HTTP transport: each JSON-RPC request is a POST that receives a JSON response, with `server/discover`, the mirrored request headers, and no sessions. Clients of the earlier [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) and 2025-06-18 versions, such as ChatGPT's, start with `initialize` and send the version in the `MCP-Protocol-Version` header; they are served the same tools and resources, also without sessions. Requests from another `Origin` are rejected. So is a browser request that reaches the endpoint from the same machine for a host that is not local, which is how a site attacks a local server by [DNS rebinding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#security--endpoint); it needs the [client IP](/app#client-ip) from your server.

The endpoint is tested with the official [MCP conformance suite](https://github.com/modelcontextprotocol/conformance) for 2026-07-28 and 2025-11-25, and with the official client libraries for both. Its scenarios for prompts, completion, and asking the client for input are not passed, since ovr has none of those, and neither are the ones that call tools and resources by fixed names, since a tool is named after its route.

## WebMCP

[WebMCP](https://developer.chrome.com/docs/ai/webmcp/declarative-api) lets an agent in the user's browser call a page's forms as tools. A route's `Form` adds the same tool name and description the MCP endpoint uses:

```html
<form
	action="/posts"
	method="POST"
	enctype="multipart/form-data"
	toolname="post_posts"
	tooldescription="Create a blog post"
>
	<!-- the route's fields and submit button -->
</form>
```

A form that may change data waits for the user to submit it, after the agent fills it in. GET forms, such as a search, add `toolautosubmit`, so the agent submits them itself and sees the results. Forms of routes with parameters, like a delete button in each row, would repeat the name, so they are not annotated; when one is the only form on its page, pass `toolname` and `tooldescription` yourself. Undescribed routes are never annotated, so an agent cannot sign in or approve itself.

Browsers without WebMCP ignore the attributes. It is in a Chrome origin trial, so add your trial token to pages to enable it for users.
