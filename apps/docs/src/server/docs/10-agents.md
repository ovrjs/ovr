---
title: Agents
description: Pages as Markdown, routes as MCP tools, and forms as WebMCP tools, so AI agents can use your app.
---

An ovr app works for AI agents the same way it works for people. Pages render as Markdown for agents that ask for it, an [MCP](https://modelcontextprotocol.io) endpoint turns your routes into tools, and forms are tools for agents in the browser. With [Auth](/08-auth#agents), the user approves the agent with their passkey and the agent acts as that user, through the same handlers.

## Markdown

A request with `Accept: text/markdown` gets the page as Markdown. Nothing changes in your routes: the JSX renders to HTML as usual, and ovr converts it while it streams, writing each block as soon as it is complete.

```sh
curl -H "Accept: text/markdown" https://example.com/posts
```

```md
# Posts

- [Hello world](https://example.com/posts/1)

**Form:** `POST https://example.com/posts`

- Title `title` (text, required)

Submit: Create post
```

- When the page has a `<main>` element, only its contents are written, leaving out the navigation and footer.
- Links and images are absolute, so an agent can follow them.
- Forms are described by where they submit, their fields with types, choices, and current values, and errors from a failed submission.
- Scripts, styles, and elements with `hidden` or `aria-hidden="true"` are left out. `<noscript>` content is kept, since agents do not run scripts.

Browsers get HTML: Markdown is only used when it is listed in `Accept` and preferred at least as much as HTML. These responses include `Vary: Accept` for caches. Responses with another content type, such as XML, are not converted.

`Render.markdown(element, { base })` streams Markdown from any element.

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

### Tools

Only [described routes](/04-route#describe) become tools, so adding a route never lets agents call it. Write the description for an agent that sees the route without your UI:

```ts
const create = Route.post("/posts")
	.describe("Create a blog post")
	.fields({ title, body })
	.use(handler);

const remove = Route.post("/posts/:id/delete")
	.describe("Delete a post permanently", { destructive: true })
	.params({ id: Schema.string().uuid() })
	.use(handler);
```

| Route                             | Agents get                       |
| --------------------------------- | -------------------------------- |
| POST and other methods, described | A tool                           |
| GET, described                    | A read-only tool, and a resource |
| GET                               | A resource, read as Markdown     |
| `describe(false)`                 | Nothing                          |

A tool's input schema combines the pattern's parameters, converted by `params` schemas, and the route's `fields`. Its name is generated from the method and pattern, for example `post_posts_id_delete`.

A tool call is a request to the route. The arguments become form data, or search parameters for GET, and the response is returned as Markdown, following redirects within the app. When `c.data()` finds issues, the agent receives them as an error with each field's message, instead of a redirect back to the form. Your handlers do not change.

`route.tool` is the name, description, and hints a route is called with, or `undefined` when it is not a tool. Names of patterns with `_` or other punctuation, or longer than 64 characters, end with a short hash of the pattern, so `/a/b` and `/a_b` get different names. Two routes cannot share a name, so a parameter and a segment with the same text, like `/drafts/:id` and `/drafts/id`, throw.

### Resources

GET routes are resources. Routes without parameters are listed; routes with parameters are templates, like `https://example.com/posts/{id}`. Reading one renders the page as Markdown.

### Sign in

Pass `auth` to require agents to sign in. The user approves the agent once in the browser, and its tool calls then act as that user: `c.session()` returns their session.

```ts
const mcp = new Mcp({ instructions: "...", auth });
```

The endpoint also mounts Auth's OAuth endpoints, and serves the protected resource metadata agents use to find them. Write the page where users approve agents at `/connect`, see [Auth agents](/08-auth#agents).

### Connect an agent

Point an MCP client at the endpoint:

```sh
claude mcp add --transport http posts https://example.com/mcp
```

### Protocol

The endpoint implements the [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) Streamable HTTP transport: each JSON-RPC request is a POST that receives a JSON response, with `server/discover`, the mirrored request headers, and no sessions. Clients of earlier versions, which start with `initialize`, are told the supported version. Requests from another `Origin` are rejected.

| Option         | Default | Purpose                                   |
| -------------- | ------- | ----------------------------------------- |
| `name`         | `ovr`   | Server name shown in clients              |
| `version`      | `1.0.0` | Server version shown in clients           |
| `instructions` | None    | Guidance for agents on how to use the app |
| `path`         | `/mcp`  | Endpoint path                             |
| `auth`         | None    | `Auth` service that agents sign in with   |

## WebMCP

[WebMCP](https://developer.chrome.com/docs/ai/webmcp/declarative-api) lets an agent in the user's browser call a page's forms as tools. A route's `Form` adds the same tool name and description the MCP endpoint uses:

```html
<form
	action="/posts"
	method="POST"
	toolname="post_posts"
	tooldescription="Create a blog post"
	toolautosubmit
></form>
```

With `toolautosubmit`, the agent submits the form itself, and sees the page it redirects to. Destructive routes leave it out, so the user confirms by clicking. Forms of routes with parameters, like a delete button in each row, would repeat the name, so they are not annotated; when one is the only form on its page, pass `toolname` and `tooldescription` yourself. Undescribed and hidden routes are never annotated, so an agent cannot sign in or approve itself.

Browsers without WebMCP ignore the attributes. It is in a Chrome origin trial, so add your trial token to pages to enable it for users.
