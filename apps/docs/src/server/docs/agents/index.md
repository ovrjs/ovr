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
- Raw markup from `Markup.raw` is written as it is, since Markdown can contain HTML.

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
| `path`         | `/mcp`         | Endpoint path                                               |
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

A tool's input schema combines the pattern's parameters, converted by `params` schemas, and the route's `fields`. A field's `label` is its `title`, so a terse name such as `dob` still reads as "Date of birth", and an unchecked `Field.checkbox()` may be left out, as browsers do. A file field takes the file's `name`, an optional media `type`, and its contents as `text`, or as `base64` when it is not text, such as `{ "name": "notes.txt", "text": "..." }`. The call's request is read into memory, so it is limited by the app's [`form.memory`](/app#form), 4MB by default. A date, time, or color field describes the format its picker sends, such as `YYYY-MM-DD`. A parameter its `params` schema rejects, such as an ID that is not a UUID, is returned to the agent as an issue, like a form's, where a browser would get a 404. A `*` wildcard is the `wildcard` argument, so describing a pattern with both `:wildcard` and `*` is a type error. Its name is generated from the method and pattern, for example `post_posts_id_delete`.

A tool call is a request to the route. The arguments become form data, or search parameters for GET, and the response is returned as Markdown, following redirects to described pages. A response that is not text, such as an image or a PDF, is returned as a file, as a person would see or download it. An event stream may never end, so the agent gets its address instead, to open itself, read as the events arrive, and close when it has enough. A redirect to another site returns its URL, such as a checkout page for the user to open. A redirect to a page of the app agents cannot read returns only that it redirected, keeping its address and any token in it private. To give an agent a link, such as a share link, describe the page it redirects to, or respond with the link instead of redirecting. When `c.data()` finds issues, the agent receives them as an error with each field's message, instead of a redirect back to the form. Your handlers do not change.

Pages an agent reads through MCP point each form that submits to a tool to that tool, such as ``(tool `post_notes_id_update`)``, with only the form's current values and messages, since the tool's input schema already describes its fields. A single checkbox's value is `true` or `false`, like its argument. Forms that submit elsewhere, and pages requested as Markdown outside MCP, describe every field.

`route.tool` is the name and description a route is called with, and whether it only reads, or `undefined` when it is not a tool. Names of patterns with `_` or other punctuation, or longer than 64 characters, end with a short hash of the pattern, so `/a/b` and `/a_b` get different names. Two routes cannot share a name: `app.use()` throws when they would, such as for a parameter and a segment with the same text, like `/drafts/:id` and `/drafts/id`, so you find out when the app starts.

### Resources

Described GET routes are resources. Routes without parameters are listed; routes with parameters are templates, like `https://example.com/posts/{id}`. Reading one renders the page as Markdown.

### Sign in

Pass `auth` to require agents to sign in. The user approves the agent once in the browser, and its tool calls then act as that user: `c.session()` returns their session.

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

The endpoint implements the [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) Streamable HTTP transport: each JSON-RPC request is a POST that receives a JSON response, with `server/discover`, the mirrored request headers, and no sessions. Clients of the earlier [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) and 2025-06-18 versions, such as ChatGPT's, start with `initialize` and send the version in the `MCP-Protocol-Version` header; they are served the same tools and resources, also without sessions. Requests from another `Origin` are rejected.

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
