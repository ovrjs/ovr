# Bookmarks: current API walkthrough

A small application written against the current `next` branch. Start with
[app.tsx](./app.tsx): it contains all the page and CRUD handlers.

| File                                                               | Responsibility                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [db.ts](./db.ts)                                                   | Account and bookmark schemas, reusable form fields, Postgres pool             |
| [auth.ts](./auth.ts)                                               | Passkey configuration and transactional account creation                      |
| [app.tsx](./app.tsx)                                               | Login, list, edit, create, update, delete, and logout UI                      |
| [migrations/0001_init.sql](./migrations/0001_init.sql)             | Application tables, constraints, indexes                                      |
| [migrations/0003_auth_users.sql](./migrations/0003_auth_users.sql) | Delete an account's passkeys and sessions with it                             |
| [migrate.ts](./migrate.ts)                                         | Apply the migrations, with `Auth.sql[1]` as `0002_auth`, and check the tables |

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

`new App({ auth })` also mounts the authentication routes and browser script.
`auth.forms(c)` supplies the registration, login, and logout components.

Every CRUD handler authenticates before doing work. Reads and mutations include
`owner = session.user` in SQL; the client cannot select the owner. A missing or
other user's bookmark returns 404. Mutations use POST forms and retain App's CSRF
protection. Bookmark links accept HTTP and HTTPS only.

The account's email labels its passkey; this example does not verify email
ownership. The unique email constraint prevents another account with the exact
same email, without merging accounts. Email normalization, verification, and
recovery are separate product choices.

## Evaluate it

The files form an application module, not a bundled HTTP server. `npm run check`
from the repository root type-checks it against the current source, so it cannot
drift from the API.

The example was also smoke-checked against an in-memory PGlite database: migration
compatibility, login-page rendering, authentication redirects, CRUD, initial edit
values, duplicate create/update errors, cross-account access rejection, invalid
UUIDs, unsafe URLs, and logout/revocation. Sessions were established through a
private test harness using `auth.login`; the browser passkey ceremony was not
exercised by this check.

Use the repository's TSX build setup with `jsxImportSource: "ovr"`. The included
tsconfig points to current source for checking; configure the same source aliases
in a bundler, or build the local `ovr` package before running it. A tsconfig path
mapping alone does not change runtime imports.

Set `DATABASE_URL`, `AUTH_ORIGIN` (an exact HTTPS origin, no trailing slash), and
`AUTH_SECRET` (a stable random server secret containing at least 32 bytes). Run
`migrate.ts` in the release step with a direct database connection; use the
application's pooled connection for requests. Migrations are written SQL, and
`db.check()` checks table compatibility without generating changes.

Connect `app` to your HTTPS server's Fetch adapter:

```ts
import { app } from "./app.js";

// Supply the verified client address from your server/edge adapter.
const response = await app.fetch(request, { ip });
```

Close the exported `pool` during shutdown. The authentication aggregate rate
limit is an example policy to size for the deployment. No pagination is included;
the list deliberately shows only the latest 50 bookmarks.

The sample persists short, non-sensitive bookmark titles and public URLs after
validation errors. `.persist()` stores these in the return URL. For private
titles, secret links, or long documents, remove that opt-in and choose a form
state strategy that does not expose those values in URLs. `no-store` and
`no-referrer` do not remove URLs from browser history or server logs.

## What this shows about the API

A `Table` validates rows, its `shape` supplies form fields, and `sql.values` and
`sql.set` handle validated writes. Raw SQL keeps ownership checks, unique
constraints, and conflict handling visible. SQL migrations, with ovr's
versioned `Auth.sql`, plus `db.check()` fit an AI-authored workflow without a
schema diff engine or query builder.

Writing this example led to `submit` labels on route forms, `Database.unique`
for constraint errors, and the versioned `Auth.sql`. Two suggestions were left
out on purpose:

- **A parse-or-redirect helper** would save one line per handler but add a
  second way to read form data; `c.data()` already returns everything needed.
- **Route parameter schemas** only make sense with typed, converted parameters.
  Until then, the handler checks the ID with the table's own column schema,
  `bookmarks.shape.id.parse(c.params.id)`.
