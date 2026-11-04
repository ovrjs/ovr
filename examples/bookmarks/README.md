# Bookmarks: current API walkthrough

A small application written against the current `next` branch. Start with
[app.tsx](./app.tsx): it contains all the page and CRUD handlers.

| File                                                                 | Responsibility                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [database.ts](./database.ts)                                         | Account and bookmark schemas, reusable form fields, Postgres pool |
| [auth.ts](./auth.ts)                                                 | Passkey configuration and transactional account creation          |
| [app.tsx](./app.tsx)                                                 | Login, list, edit, create, update, delete, and logout UI          |
| [migrations/0001_init.sql](./migrations/0001_init.sql)               | Application tables, constraints, indexes                          |
| [migrations/0002_auth_users.sql](./migrations/0002_auth_users.sql)   | Delete an account's passkeys and sessions with it                 |
| [migrations/0003_auth_tokens.sql](./migrations/0003_auth_tokens.sql) | Disconnect an account's agents with it                            |
| [migrate.ts](./migrate.ts)                                           | Apply the migrations, after Auth's own, and check the tables      |

## Routes

| Method | Path                    | Behavior                                                  |
| ------ | ----------------------- | --------------------------------------------------------- |
| GET    | `/`                     | Redirect to the bookmarks page                            |
| GET    | `/login`                | Passkey login and registration forms                      |
| GET    | `/bookmarks`            | Latest 50 owned bookmarks and a create form               |
| POST   | `/bookmarks`            | Create a bookmark; show a field error for a duplicate URL |
| GET    | `/bookmarks/:id/edit`   | Load an owned bookmark into the update form               |
| POST   | `/bookmarks/:id`        | Update an owned bookmark; handle duplicate URL conflicts  |
| POST   | `/bookmarks/:id/delete` | Delete an owned bookmark                                  |
| GET    | `/connect`              | Approve an agent that connects through MCP                |
| POST   | `/mcp`                  | MCP endpoint for agents                                   |

`app.use(auth)` mounts the authentication routes and browser script, and
`app.use(mcp)` the MCP endpoint.
`auth.forms(c)` supplies the registration, login, and logout components.

Every CRUD handler authenticates before doing work. Reads and mutations include
`owner = session.user` in SQL; the client cannot select the owner. A missing or
other user's bookmark returns 404. Mutations use POST forms and retain App's CSRF
protection. Bookmark links accept HTTP and HTTPS only.

The account's email labels its passkey; this example does not verify email
ownership. The unique email constraint prevents another account with the exact
same email, without merging accounts. Email normalization, verification, and
recovery are separate product choices.

## Agents

The described routes are MCP tools: `post_bookmarks` saves, `post_bookmarks_id`
edits, and `post_bookmarks_id_delete` deletes; agents' clients can confirm each with the user. The list and
edit pages are read-only tools, and every page is a Markdown resource. An agent
connecting to `/mcp` signs in through OAuth: the user logs in with their passkey
and approves it on `/connect`, and its tool calls run the same handlers as that
user, so ownership checks apply unchanged. Requests with
`Accept: text/markdown` get any page as Markdown.

## Evaluate it

The files form an application module, not a bundled HTTP server. `npm run check`
from the repository root type-checks it against the current source, so it cannot
drift from the API.

The example was also smoke-checked against an in-memory PGlite database: migration
compatibility, login-page rendering, authentication redirects, CRUD, initial edit
values, duplicate create/update errors, cross-account access rejection, invalid
UUIDs, unsafe URLs, and logout/revocation. Sessions were established through a
private test harness using `auth.login`; the browser passkey ceremony was not
exercised by this check. The migrations were applied and checked on Postgres 18
before Auth's tables brought their own. The MCP and OAuth flows are covered by ovr's own
tests; they were not exercised against this example.

Use the repository's TSX build setup with `jsxImportSource: "ovr"`. The included
tsconfig points to current source for checking; configure the same source aliases
in a bundler, or build the local `ovr` package before running it. A tsconfig path
mapping alone does not change runtime imports.

Set `DATABASE_URL`, `AUTH_ORIGIN` (an exact HTTPS origin, no trailing slash), and
`AUTH_SECRET` (a stable random server secret containing at least 32 bytes),
generated once with:

```bash
node -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).toHex())'
```

Run `migrate.ts` in the release step with a direct database connection; use the
application's pooled connection for requests. Migrations are written SQL, and
`database.check()` checks table compatibility without generating changes.

Connect `app` to your HTTPS server's Fetch adapter:

```ts
import { app } from "./app.js";

// Supply the verified client address from your server/edge adapter.
const response = await app.fetch(request, { ip });
```

Close the exported `pool` during shutdown. For a public deployment, add an
aggregate limit on authentication at your edge, as the Auth guide describes. No
pagination is included; the list deliberately shows only the latest 50 bookmarks.

The sample persists short, non-sensitive bookmark titles and public URLs after
validation errors. The routes choose `.persist()` for the table's fields, which
stores these in the return URL, while the table keeps only their validation. For
private titles, secret links, or long documents, remove that opt-in and choose a
form state strategy that does not expose those values in URLs. `no-store` and
`no-referrer` do not remove URLs from browser history or server logs.

## What this shows about the API

A `Table` validates rows, its `shape` supplies form fields, and `sql.values` and
`sql.set` handle validated writes. Raw SQL keeps ownership checks, unique
constraints, and conflict handling visible. SQL migrations, with the
versioned migrations Auth's tables bring, plus `database.check()` fit an AI-authored workflow without a
schema diff engine or query builder.

Writing this example led to `submit` labels on route forms, `Database.unique`
for constraint errors, and versioned Auth migrations. Chained routes let
`.params({ id })` check IDs with the table's own column schema before the
handler runs, so an invalid UUID is a 404. A parse-or-redirect helper was left
out on purpose: it would save one line per handler but add a second way to read
form data, and `c.data()` already returns everything needed.
