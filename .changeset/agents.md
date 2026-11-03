---
"ovr": minor
---

Make apps usable by AI agents.

- **Markdown pages:** requests that prefer `Accept: text/markdown` receive pages as Markdown, converted from the rendered HTML as it streams. Only the `<main>` element is written when there is one, and forms are described with their fields, values, and errors. HTML responses include `Vary: Accept`. `Render.markdown(element)` streams Markdown from any element.
- **MCP:** `app.use(new Mcp({ instructions }))` serves a Model Context Protocol endpoint at `/mcp`, implementing the 2026-07-28 Streamable HTTP transport. Only described routes become tools, with input schemas from their parameters and fields, so mounting a route never exposes it; GET routes are Markdown resources. Tool calls run the route's handlers, and form issues are returned to the agent.
- **WebMCP:** a route's `Form` adds the declarative WebMCP attributes, `toolname`, `tooldescription`, and `toolautosubmit` for GET forms only, so agents in the browser call it as the same tool and the user submits forms that change data. Forms of routes with parameters and of undescribed routes are not annotated. `route.tool` is the name, description, and hints agents call a route with.
- **Agent sign in:** with `new Mcp({ auth })` and a consent page, `/connect` by default, agents sign in through OAuth 2.1 with PKCE: the user approves the agent with their passkey, asked for again on Allow so a script driving a signed-in browser cannot approve it, and the agent's tool calls act as that user through `c.session()`. Agents identify themselves with client ID metadata documents, fetched only from public addresses, which requires Node.js or Bun. Downloads are limited per IP, per document host, and at once, and found agents are kept for 5 minutes. Auth stores hashed, resource-bound tokens in a table its second migration creates, and adds `auth.consent(c)` and `auth.bearer(c, resource)`.

App CSRF protection allows requests with neither `Sec-Fetch-Site` nor `Origin` and without cookies. Browsers always send at least one of the headers, so non-browser clients such as MCP clients can post.
