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
- Forms are described by where they submit and how to encode the body, their fields with types, rules such as `required`, choices, and current values, and errors from a failed submission. A form in a table's cell that is only a button, such as a delete in each row, is written in the cell as ``Delete: `POST https://example.com/posts/1/delete` ``. One with fields is written after the table. A form around a table, such as one with a checkbox in each row, keeps the table, with each control named in its cell as `` `ids=1` ``, followed by `(checked)` for a box that is ticked, and a select as the option chosen.
- Scripts, styles, and elements with `hidden` or `aria-hidden="true"` are left out. `<noscript>` content is kept, since agents do not run scripts.
- Raw markup from [`Render.raw`](/render#raw) is written as it is, since Markdown can contain HTML, or as the `markdown` it is given with.

To render Markdown yourself, such as part of a page, use [`new Render({ markdown })`](/render#markdown-output).

Browsers get HTML: Markdown is only used when it is listed in `Accept` and preferred at least as much as HTML. These responses include `Vary: Accept` for caches. Responses with another content type, such as XML, are not converted. A page served from a static file, such as a prerendered one, never reaches the app, so it is always HTML.

### Markdown source

A page that is a Markdown document, such as a blog post or a docs page, can give agents its source instead. Its HTML from a Markdown processor, with highlighted code, is often several times longer.

```tsx
const post = Route.get("/posts/:slug").use(async (c) => {
	const post = await posts.get(c.params.slug);

	if (c.markdown(post.markdown)) return;

	return <Post html={post.html} />;
});
```

`c.markdown(body, status)` responds with the Markdown and returns `true` when the request asks for Markdown, otherwise it returns `false` and the page renders for the browser. It runs in the handler, after the route's middleware, such as a sign-in check.

### Text for one audience

[`Render.raw`](/render#raw) with `markdown` gives agents one thing and people another, and either may be left empty:

```tsx
<p>
	{recipe.meal}
	{/* agents only: CSS sets these apart for people */}
	{Render.raw({ markdown: " · " })}
	{recipe.time}
	{/* people only */}
	{Render.raw({
		markup: '<button type="button">Read more</button>',
		markdown: "",
	})}
</p>
```

One line of source stays in its line, as the separator above does in its list item or sentence. Source of several lines, or with HTML that starts with a block element such as `<h2>`, is its own block.

An element with `hidden` or `aria-hidden="true"` is left out of Markdown. One that CSS hides is not, since the page's styles are not read: text in a `display: none` element is another way to write for agents only, which a screen reader also skips.

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

| Route                             | Agents get          |
| --------------------------------- | ------------------- |
| POST and other methods, described | A tool              |
| GET, described                    | A read-only tool    |
| Not described                     | Nothing through MCP |

A tool call is a request to the route. The arguments become form data, or search parameters for GET, and the response is returned as Markdown. Your handlers do not change. An agent reads a page by calling its GET route's tool.

The endpoint itself is outside your app's [global middleware](/middleware#composition): the request it makes to the route is the one that passes through it, once, like a person's request to the same route.

#### Names

A tool's name is generated from the method and pattern, for example `post_posts_id_delete`.

- Punctuation in a pattern is a `_` in the name, so `/@:username` is `get_username`.
- A name longer than 64 characters is cut and ends with a short hash of the pattern.
- Two routes cannot share a name: `app.use()` throws when they would, such as for a parameter and a segment with the same text, like `/drafts/:id` and `/drafts/id`, or for `/a/b` and `/a_b`, so you find out when the app starts.
- A `*` wildcard is the `wildcard` argument, so describing a pattern with both `:wildcard` and `*` is a type error.

A name is public: clients save it and directories list it. Moving a route renames its tool, so treat the pattern of a described route as you would a published URL.

`route.tool` is the name, title, and description a route is called with, whether it only reads, and whether it is destructive, or `undefined` when it is not a tool.

#### Titles and hints

A tool's `title`, which a client shows people, is the description's first sentence, so start with a short line such as "Delete a post" and put detail in a second sentence.

A tool that only reads is marked `readOnlyHint`, and one that writes `destructiveHint`, since it may change or delete what is there, so a client may ask the person before calling it. A route that only adds says so with [`destructive: false`](/route#describe).

#### Arguments

A tool's input schema combines the pattern's parameters, converted by `params` schemas, and the route's `fields`. A form's tool takes only its fields and parameters, so an argument it does not have is an issue naming it. A route without fields is left open, since its handler may read the query or the body itself.

| Field                          | What the agent sends                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Text, number, and other inputs | A value of the field's type, with its rules                                                           |
| `Field.checkbox()`             | `true` or `false`, and it may be left out when unchecked, as browsers do                              |
| Select, radio, and checkboxes  | One of the values, or an array of them. A choice's label is listed beside its value                   |
| Date, time, month, week, color | Text in the format the picker sends, which the description says, such as `Date as YYYY-MM-DD.`        |
| `Field.textarea().lines()`     | An array of strings                                                                                   |
| `Field.list()`                 | An array of its items, each an object of its fields when it has several                               |
| `.json(schema)`                | The value its schema describes; the route receives it as the JSON text a form would send              |
| `Field.file()`                 | The file's `name`, an optional media `type`, and its contents as `text`, or as `base64` when not text |

- A field's `label` is its `title`, so a terse name such as `dob` still reads as "Date of birth". What it is given with [`describe`](/schema#post-forms) is its `description`, never its `hint`, which is only for people.
- A write updates only the arguments an agent gave, see [`result.updates`](/schema#update-a-record).
- The call's request is read into memory, so it is limited by the app's [`multipart.memory`](/app#multipart), 4MB by default.
- A client may state the user's language. The route receives it as `Accept-Language`, as a person's browser sends it, and the `Content-Language` the route answers with is reported back to the client.

#### Results

| The route answers with                        | The agent gets                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| A page                                        | Its Markdown                                                                    |
| JSON, such as `c.json()`                      | The text, and the same value as `structuredContent` when it is an object        |
| An image or audio                             | `image` or `audio` content                                                      |
| Another file, such as a PDF                   | An embedded resource with its `blob`                                            |
| A page with `Content-Disposition: attachment` | The page's HTML as a file, not read as Markdown                                 |
| A redirect, from a read                       | The page it leads to, when that page is described, as a browser follows it      |
| A redirect, from a write                      | One line saying where, such as `Redirected to /recipes`                         |
| A redirect to another site                    | Its URL, such as a checkout page for the user to open                           |
| An event stream                               | Its address, to open itself; with `auth`, for the user to open in their browser |

- A write that redirects is done, so the agent is not sent the page: deleting one recipe would otherwise return the whole list. It reads the page if it needs it, so put what an agent needs after a write, such as a new record's ID, in the address it redirects to.
- A redirect to a page of the app agents cannot read returns only that it redirected, keeping its address and any token in it private. To give an agent a link, such as a share link, describe the page it redirects to, or respond with the link instead of redirecting.
- A page sent as an attachment is for one an agent passes on, such as one to print. It is the whole page as a browser gets it, with what Markdown leaves out, such as scripts and hidden inputs, so send only a page made to be handed on. The same page is HTML for any request that asks for Markdown.
- An event stream may never end, so it is not read: the agent reads it as the events arrive, and closes it when it has enough.

#### Errors

| What happened                                    | The agent gets                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `c.data()` finds issues                          | An error result with each field's message, instead of a redirect back to the form |
| A parameter its `params` schema rejects          | An issue, like a form's, where a browser would get a 404                          |
| A response it can act on, such as a 403 or a 404 | An error result with the response's text                                          |
| A rate limit                                     | An error result that says when to retry                                           |
| A status of 500 or more                          | The protocol's internal error, -32603 with the status in its `data`               |
| A response over 4MB                              | The protocol's internal error, `Response too large`                               |

A server error is the app's to fix, so the agent does not get your error page. That needs your app to [catch its errors](/middleware#not-found-and-errors): one that nothing catches leaves `app.fetch`, as from any route.

#### Forms in a page

Pages an agent reads through MCP give each form as the call to its tool, with the arguments the form's address holds, such as a delete beside each item:

```md
- [ovr](https://ovrjs.com/)
  Delete ovr: tool `post_bookmarks_id_delete`, `id`: `0b8f5d0a`
```

- A form with current values or messages, such as an edit form, lists them under the tool's name, since the tool's input schema already describes its fields.
- Choices given as the page renders, such as a record's own photos, are listed there too, since the schema can't hold them.
- A list's current items are shown as the array an agent sends, and a table that only lays out the list's rows is left out.
- A single checkbox's value is `true` or `false`, like its argument.
- A form that submits to a route you have not described is left out, as the agent has no tool to submit it with.

Pages requested as Markdown outside MCP describe every form, with its address and fields.

### Guide

Many clients do not show the server's `instructions` to the agent or the person. Describe a page with the same text, and the agent has a tool that returns it:

```tsx
const instructions = "Write and manage the user's blog posts. ...";

const guide = Route.get("/guide")
	.describe("How to use this app. Read this first.")
	.use(() => <main>{instructions}</main>);

app.use(new Mcp({ instructions }), guide);
```

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

How clients we know of connect, as of November 2026:

| Client           | How it connects                                                                     |
| ---------------- | ----------------------------------------------------------------------------------- |
| Claude           | Publishes its own client document                                                   |
| ChatGPT          | Publishes its own client document, and speaks a 2025 version, starting `initialize` |
| Muse             | Asks for a client ID: [host a document for it](/auth#agents)                        |
| OpenCode, Gemini | Need dynamic client registration, which ovr does not have, so they cannot sign in   |

### Test with a request

The endpoint keeps no session, so every request says which version of the protocol it speaks. A request without one is refused with `Unsupported protocol version` and the versions it accepts. Send the `MCP-Protocol-Version` header to call it from a script:

```bash
curl https://localhost:5173/mcp \
	-H "Content-Type: application/json" \
	-H "MCP-Protocol-Version: 2025-11-25" \
	-d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

With `auth`, the request also needs a token, which only a signed-in user's approval gives, so connect a real client to try a signed-in tool. In a test, [`Tester`](/test#as-an-agent) calls a tool as a signed-in user's agent.

### Publish to a directory

Directories that list MCP servers, such as Claude's and ChatGPT's, check each tool. ovr gives every tool what they ask for: a `title`, `readOnlyHint`, `destructiveHint`, `openWorldHint`, and a `type` on every argument.

- Read each title as a person browsing the directory would, and mark the routes that only add with `destructive: false`.
- A directory keeps its own copy of the tool list, so after you rename a tool by moving its route, update the listing.

### Protocol

The endpoint implements the [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) Streamable HTTP transport: each JSON-RPC request is a POST that receives a JSON response, with `server/discover`, the mirrored request headers, and no sessions. Clients of the earlier [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) and 2025-06-18 versions, such as ChatGPT's, start with `initialize` and send the version in the `MCP-Protocol-Version` header; they are served the same tools, also without sessions. Requests from another `Origin` are rejected. So is a browser request that reaches the endpoint from the same machine for a host that is not local, which is how a site attacks a local server by [DNS rebinding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#security--endpoint); it needs the [client IP](/app#client-ip) from your server.

The endpoint is tested with the official [MCP conformance suite](https://github.com/modelcontextprotocol/conformance) for 2026-07-28 and 2025-11-25, and with the official client libraries for both. Its scenarios for resources, prompts, completion, and asking the client for input are not passed, since ovr has none of those, and neither are the ones that call tools by fixed names, since a tool is named after its route.

## WebMCP

[WebMCP](https://developer.chrome.com/docs/ai/webmcp/declarative-api) lets an agent in the user's browser call a page's forms as tools. A route's `Form` adds the same tool name and description the MCP endpoint uses:

```html
<form
	action="/posts"
	method="POST"
	enctype="multipart/form-data"
	toolname="post_posts"
	tooltitle="Create a blog post"
	tooldescription="Create a blog post"
>
	<label for="title">Title</label>
	<input
		id="title"
		name="title"
		toolparamdescription="Title: Shown in the list"
	/>
	<!-- the route's other fields and submit button -->
</form>
```

The browser builds the tool's input from the form's controls and reads each one's label. A field with a [description](/schema#post-forms) adds `toolparamdescription`, its label and description, never its `hint`, and so does each cell of a [list](/schema#lists), which is named by its column's heading. A radio or checkbox group has it on its `<fieldset>`, where the browser reads a group's, and not on each box; in a list's cell the group is a fieldset too, named by its column's heading. A list is an argument for each cell on the page, such as `ingredients.0.name`, where the MCP endpoint takes an array.

A form that may change data waits for the user to submit it, after the agent fills it in. GET forms, such as a search, add `toolautosubmit`, so the agent submits them itself and sees the results. Forms of routes with parameters, like a delete button in each row, would repeat the name, so they are not annotated; when one is the only form on its page, pass `toolname` and `tooldescription` yourself. Undescribed routes are never annotated, so an agent cannot sign in or approve itself.

Browsers without WebMCP ignore the attributes. It is in a Chrome origin trial, so add your trial token to pages to enable it for users. The page's tools are at `document.modelContext`: `await document.modelContext.getTools()` in the console lists them.
