---
"ovr": minor
---

Apps are usable by AI agents: a described route is a tool, through MCP and WebMCP, and every page reads as Markdown.

```ts
const create = Route.post("/posts")
	.describe("Create a post", { destructive: false })
	.fields({ title: Field.text() })
	.use(handler);

app.use(new Mcp({ name: "posts", instructions: "Manage the user's posts." }));
```

- **MCP:** `new Mcp(options)` serves a Model Context Protocol endpoint at `/mcp`: the 2026-07-28 Streamable HTTP transport, and the 2025-11-25 and 2025-06-18 versions that start with `initialize`, all without sessions. It takes `name`, `title`, `version`, `description`, `websiteUrl`, `icons`, `instructions`, `path`, and `auth`. Requests from another `Origin` are refused.
- **Tools:** only a route with `describe()` is a tool, so adding a route never lets agents call it. Its input schema is the route's parameters and fields, with each field's label, description, and constraints. A tool call runs the route as a request, so one handler serves people and agents. An agent reads a page with its GET route's tool.
- **`describe(text, options)`:** the first sentence is the tool's title. A route that writes is marked destructive unless it says `destructive: false`, and `idempotent: true` says it is safe to retry. The text may be a function, to name another route's tool with `other.tool.name()`. `route.tool` has the tool's `name()`, `title`, `description`, and hints.
- **Arguments:** a `.json(schema)` field takes the value its schema describes, a list field an array, and a file field the file's `name`, `type`, and its contents as `text` or `base64`. A write changes only the arguments an agent gave, through `result.updates`.
- **Results:** a page is returned as Markdown, JSON also as `structuredContent`, an image or audio as its own content, and another file as an embedded resource. Form issues and rejected parameters come back as issues. A write that redirects returns one line saying where, such as `Redirected to /recipes`, so put what an agent needs after a write, such as a new record's ID, in the address.
- **Forms in a page:** a page read through MCP gives each form as the call to its tool, with its current values and choices. A form whose route is not described is left out.
- **Middleware:** the endpoint runs outside the app's global middleware. The request it makes to a route for each tool call passes through global middleware once, as the agent's user.
- **Sign in:** with `new Mcp({ auth })`, agents sign in through OAuth 2.1 with PKCE, identified by a client ID metadata document, and the user approves each with their passkey. See the auth entry.
- **WebMCP:** a route's `Form` adds the declarative WebMCP attributes, such as `toolname` and `tooldescription`, so an agent in the browser calls it as the same tool.
- **Language:** an MCP client's language reaches the route as `Accept-Language`.
