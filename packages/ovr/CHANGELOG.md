# ovr

## 7.0.0-next.28

### Patch Changes

- 6b5218e: A `<script>` takes any `type`, so a block of data such as `<script type="application/ld+json">` type checks. `module`, `importmap`, `speculationrules`, `application/ld+json`, and `application/json` are still suggested.

## 7.0.0-next.27

### Patch Changes

- c7045d9: A JSON Schema for a literal or an enum says its values' type beside them, such as `{ "type": "string", "enum": ["dinner", "lunch"] }`, so a select, radio, or checkboxes field in an MCP tool's input has a type, which some clients and directories require of every parameter. Values of several types list each one.

## 7.0.0-next.26

### Minor Changes

- 23ac836: - An MCP tool has a `title`, the first sentence of its route's description.
  - A tool says `destructiveHint`: `true` for one that writes and `false` for one that reads. Clients already assumed a write may be destructive, so they behave as before, and directories that require the hint now get it.
  - `describe(description, { destructive: false })` marks a route that only adds, such as one that creates a record, and never changes or deletes what is there. Its tool says `destructiveHint: false`, so a client need not confirm it. `route.tool.destructive` reads it.

## 7.0.0-next.25

### Patch Changes

- d82e9b9: The error for `preprocess()` on a table column says what to do: convert the value in your handler before inserting, or have the field reject what should not be stored.

## 7.0.0-next.24

### Patch Changes

- A tool's form lists every choice given as the page renders, however many there are.

## 7.0.0-next.23

### Patch Changes

- 07985dd: A tool's form with more than 20 choices given as the page renders lists the first five and how many there are, such as `options: 5 of 70`, so a page with a select of every record stays short for an agent. A form an agent submits itself still lists every choice.

## 7.0.0-next.22

### Patch Changes

- aec8805: When adding a passkey asks for a recent sign-in, the `Add` form confirms the person with a passkey they already have, and they press the button once more to add the new one. They no longer sign out and in again.

## 7.0.0-next.21

### Patch Changes

- cdfc7de: Adding a passkey asks for a sign-in within the last ten minutes, in that browser. A passkey outlasts the session that adds it, so a session taken over later cannot make itself a permanent way in. The form says to sign in again.

## 7.0.0-next.20

### Patch Changes

- b226add: - A list reads its rows in one pass. Before, a request with many rows cost the whole form again for every cell, so a large one could hold the server for seconds. A list also takes no more rows in one request than its `max()`, or 1,000 without one.
  - A `_return` path with a tab or a new line in it, which a browser reads as another site, is not followed after sign-in.
  - Form state in a URL shows no more rows of a list than it takes, and never sets a row's hidden value.
  - The page a sign-in link opens is sent with `Referrer-Policy: no-referrer`.
  - A file's name in an agent's tool result is only a name.
  - A write that redirects answers an agent `Redirected to /recipes`, without the `Done.` that next.18 put before it.

## 7.0.0-next.19

### Minor Changes

- 67d0646: - `result.updates` from `c.data()` is what a request sets, to update a record with: each field it sent, `null` for one sent empty, and nothing for one it left out, which keeps its value. A form sends every field it has, and an agent's tool call only the arguments it gives, so an agent that leaves a field out no longer clears it. `database.sql.set(table, result.updates)` writes it.
  - A page a route sends with `Content-Disposition: attachment` is HTML for an agent too, and its tool result is the file, an embedded resource, where before it was read as Markdown. Use it for a page an agent passes on, such as one to print.

## 7.0.0-next.18

### Minor Changes

- d47e587: An agent's tool call that writes and redirects to a page is answered with one line, such as `Done. Redirected to /recipes`, where before it got the whole page it redirected to. A read still follows its redirect. An agent that needs the page reads it, so put what it needs after a write, such as a new record's ID, in the address.

## 7.0.0-next.17

### Patch Changes

- 73ab2d5: - A date, date and time, month, week, time, or color field checks its value's format, and that a date is a real day. Before, any text passed, so an agent's `11/12/2026` reached the handler and failed there. It now gets an issue such as "Enter a date as YYYY-MM-DD".
  - A sign-in link lasts five minutes, and `auth.link` no longer takes `minutes`.

## 7.0.0-next.16

### Minor Changes

- 9d8f561: - A passkey has what tells it apart in a list: `created`, the `origin` it was made at, and a `name`, which the `Add` form takes as an optional field.
  - `auth.link(user, { origin, minutes })` makes a link that signs a user in once, for an origin where they have no passkey or after losing their device. It opens the authentication `page`, where `<Link />` from `auth.forms(c)` is the button that signs them in. Only the link's hash is stored, in the new `auth_links` table.
  - `auth:1` changed for these, since v7 is not released: `auth_credentials` has three more columns and `auth_links` is new. A database migrated with an earlier prerelease needs the same changes made by hand, and the migration's checksum updated.

## 7.0.0-next.15

### Minor Changes

- 3d16902: `auth.forms(c)` has an `Add` form that adds another passkey to the account signed in, such as for a second device or one that replaces a lost device. It asks for a passkey for the same account, skips an authenticator that already holds one of the account's, and returns to the page it is on. The docs show how to remove a passkey and how to sign a user in once at a new origin so they can add one there.

## 7.0.0-next.14

### Patch Changes

- a1503de: - A persisted `lines()` keeps each line of up to 512 characters, where before the whole text had that limit. The same goes for each value of a checkbox group or a select with `multiple()`.
  - Attributes passed to a radio or checkbox group, such as `class` and `id`, are its fieldset's, as a list's are. Before, every box had them. Each box still has what `control()` set, and `required`.
  - A radio or checkbox group's description follows its legend, before its options, as a list's does.

## 7.0.0-next.13

### Minor Changes

- 50bd4db: - `Field.hint(text)` is what people read under a control in place of the field's description, for a description written to be complete for an agent. Agents still read the description, and an empty hint shows people nothing. A list's table lists each column's hint.
  - A label in `options` given as a form renders may be an element, such as an image. An agent reading the page reads an image in a label by its `alt`.

## 7.0.0-next.12

### Patch Changes

- 55bf74e: A list's table is in a `<div>` of its own, so a wide table can scroll sideways alone, with `overflow-x: auto` on it, and the text around it keeps the fieldset's width.

## 7.0.0-next.11

### Patch Changes

- ac0b834: - A list's description follows its legend, before the rows it explains.
  - In a list's table, a column's heading holds only its label, which names each cell, and the fields' descriptions are listed once under the table, where a long one has room.
  - Attributes passed to a list, such as `class` and `id`, are its fieldset's. Before, each row's control had them and the fieldset had none.
  - An issue shown under a list says the field by its label, such as "Row 2, Ingredient: Required field".

## 7.0.0-next.10

### Minor Changes

- 5e45c54: - `Field.select()`, `Field.radio()`, and `Field.checkboxes()` take an object of each value and its label, such as `Field.select({ dinner: "Dinner", crockpot: "Slow cooker" })`. People see the label, the value is what is sent, and the tool's description tells agents each value's label. `options` given as a form renders takes the same, such as `{ [recipe.id]: recipe.title }`, which a list passes to each row.
  - `placeholder` on a select is the text of its empty first choice, such as `control({ placeholder: "Any meal" })`. A select that must be chosen starts with that choice too when it has one.
  - A list of several fields renders as a table: a column for each field, named and described once in its heading, and a row for each item with each cell's control and issue. A list of one field is unchanged.

## 7.0.0-next.9

### Patch Changes

- f5b3830: - A table that lays out a list's rows is left out of the page an agent reads through MCP, since the tool's form already lists the items as the array it takes. In a table that is kept, a checkbox says when it is checked and a select shows the option chosen.
  - A row's control from `component` is no longer read with a description it may not render. The default layout, which renders each cell's description, still is.
  - An issue of a row that is not shown again, in a list that is not persisted or has too many rows to keep, is shown under the list and says where it was, such as "Row 2, name: Required field".
  - `min()` and `max()` say "At least 2" and "At most 7", and "At most 80 characters" for text, instead of "Expected maximum 7".

## 7.0.0-next.8

### Minor Changes

- b70f101: - `min()` and `max()` count an array's items: `Schema.array(schema).max(5)`, `Field.textarea().lines().max(10)`, `Field.checkboxes(tags).max(3)`, and `Field.list(item).min(2)`. They are `minItems` and `maxItems` in its JSON Schema. Before `lines()`, they still check each line's text.
  - `Field.list(item).control({ rows })` sets how many rows the list shows wherever it renders, and `rows` on one form overrides it, as with any field's attributes. A list never shows more rows than its `max()`, so a full list has no empty row.

## 7.0.0-next.7

### Minor Changes

- 63bc0c6: `Field.lines()` is now `Field.textarea().lines()`: a textarea is text, and `lines()` takes it as a list of its lines. Each line is checked as the textarea checks its text, so `Field.textarea().max(80).lines()` limits each line, and its label, description, and control attributes are kept.

## 7.0.0-next.6

### Minor Changes

- 8ae55b4: `Field.list()` and `Field.lines()` are lists a route gets as an array, from people and agents alike, so one route serves both.

  - `Field.lines()` is a list of text, such as steps or tags. People write one on each line of a textarea and agents send an array of strings.
  - `Field.list(item)` is a list of items in order, where an item may repeat. Each item is one field, such as `Field.list(Field.select(Schema.string().uuid()))`, or several by name, such as `Field.list({ amount: Field.number(), name: Field.text() })`. It renders a row for each item and an empty one, and agents send an array. `rows` sets how many rows to show, and `component` gives each row's components for a custom layout.
  - An agent reading an edit form's page through MCP sees a list's current items as the array its tool takes.

### Patch Changes

- 8ae55b4: - A select that may be left empty, such as `Field.select(options).optional()`, starts with an empty choice. Before, the browser chose its first option, so it could not be left empty.
  - Text sent to a number field, such as an agent's `"Keep"`, is answered with "Enter a number" instead of "Required field". A number field left empty is still a required field.
  - A date, time, month, week, or color field without a description of its own ends its format as a sentence, such as `Date as YYYY-MM-DD.`

## 7.0.0-next.5

### Minor Changes

- 6cdc44e: `Field.taken(message)` is what to say when a user already has a public value no two users share, such as a username. Registration checks a users table's `taken()` fields before the passkey prompt and shows the message on the field. Other conflicts, such as an email's, stay generic.

### Patch Changes

- 8f8e748: - A registration field that fails its schema shows its own message, such as a `refine()`'s, in place of "Check this field." The registration options endpoint answers 422 with `{ fields: { name: message } }`.
  - The agents docs give both codes for a missing resource: -32602, and -32002 for clients of the 2025 versions.

## 7.0.0-next.4

### Patch Changes

- 554b09d: A field's description joined with more, such as a date's format, always ends as a sentence, whether or not the description has its own period.

## 7.0.0-next.3

### Patch Changes

- fb72889: - Choices given as a page renders, from a field made with a schema such as `Field.checkboxes(Schema.string().uuid())`, are listed under the form's tool when an agent reads the page through MCP, since the tool's input schema can't hold them.
  - A field's description keeps its last period in the tool's input schema. When it is joined with more, such as a date's format or a file's guidance, the whole description ends as a sentence.
  - The package includes `CHANGELOG.md`.

## 7.0.0-next.2

### Minor Changes

- 2aef12e: - `Field.checkboxes()`, `Field.radio()`, and `Field.select()` take a schema that checks each value, such as `Schema.string().uuid()`, as well as a list of options. The options are given as the page renders, as `options` on the field's `Field` or `component`, for choices such as a record's own photos.
  - `auth.forms(c)` reads `_return` from the login page's URL, so `/login?_return=/recipes/1` brings the user back there after they register or log in. Only a path of the app's own origin is followed.
  - `Markdown.raw(markdown, html)` renders the HTML on pages and the Markdown source for agents reading the page as Markdown.

### Patch Changes

- 9970bef: A file field's `describe()` text reaches agents in its tool's input schema, before how to send the file, where the file guidance replaced it. A tool call over the app's `multipart.memory` says the limit, in the message and as `data.limit`, so an agent knows how far to shrink a file.

## 7.0.0-next.1

### Patch Changes

- A tool's `.json(schema)` field takes the value its schema describes, such as an array of objects, and the route receives it as one JSON value. Its input schema asked for a string of JSON, which agents had to escape.

## 7.0.0-next.0

### Major Changes

- fc30a95: Routes are defined with a chain. `Route.get(pattern)`, `Route.post(pattern)` and `new Route(method, pattern)` take no middleware; add it with `route.use(...middleware)`, and form fields with `route.fields(shape)`:

  ```ts
  // before
  const create = Route.post("/posts", { title }, handler);

  // after
  const create = Route.post("/posts").fields({ title }).use(handler);
  ```

  - **Chain:** each step returns the route. `route.params(schemas)` checks and converts pattern parameters before the middleware runs, types `c.params` with the converted values, and responds 404 when one fails. `route.describe(text)` describes the route for AI agents; undescribed routes are never served to them. `Route.post(pattern)` requires a pattern, and the generated hash patterns are removed.
  - **Middleware on its own:** a `Middleware` written outside a route fits any route, including one with fields or converted parameters, where it was a type error on a route with fields. Its `c.params` values are `unknown`, and `c.data()` is the route's parsed fields or `null`.
  - **Mounting:** `route.middleware` is a read-only copy; add middleware with `use`. Once `app.use()` mounts a route, it is final, and configuring it throws.
  - **URLs:** `route.pathname()` is removed: `route.url({ params })` builds the path, typed exactly when it has no `search` or `hash`. It fills parameters and wildcards anywhere in a segment, such as `/file-:id` and `/files-*`, and takes a parameter as a string, a number, or a bigint, as a `params` schema may have converted it, as do `Anchor`, `Form`, and `Button`. It throws for a parameter that would leave its segment, be empty, `.`, or `..`, and when a value would make the path start with `//`, which browsers read as another host.
  - **Encoding:** `url()` and the route components encode parameter values, so a value such as `a/b?c` stays in its own segment, and a wildcard keeps its slashes. Matched parameters are decoded for handlers and `params` schemas: `/api/a%20b` gives `"a b"`. A wildcard keeps an encoded `/` or `\`, so a request cannot add segments to its path, and a malformed escape is left as sent. Apps that decode parameters themselves should stop.
  - **Wildcards:** a wildcard param never starts with `/`: `/files//etc/passwd` gives `"etc/passwd"`, so joining it to a folder cannot leave the folder.
  - **Trailing slash:** a request no route matches is redirected only when the other spelling of its path matches a route. A matched route always answers, so its handler no longer runs and is then replaced by a redirect.
  - **Request data:** `c.data()` reads a route's fields from the request body for every method except GET and HEAD, which read the URL. PUT, PATCH, and DELETE routes with fields read the URL before.
  - **Responses:** a returned `Response` keeps each of its `Set-Cookie` headers, added to cookies already set. Content returned with a `Content-Type` such as `Text/HTML` or `text/html ; charset=utf-8` is escaped as markup, since media types ignore case and spaces. Parameter names in `Content-Type` and `Content-Disposition`, such as `Boundary`, match in any case.
  - **Runtimes:** ovr uses native Base64 and WebAuthn JSON APIs, such as `Uint8Array.toBase64` for form state, and supports only the latest Node.js LTS release and current browsers. The runtime support policy is documented, without a package `engines` restriction.
  - **CSRF:** the app allows requests with neither `Sec-Fetch-Site` nor `Origin` and without cookies. Browsers always send at least one of the headers, so non-browser clients, such as an agent submitting a form, can post.

- fc30a95: Forms are a route's fields, set up by chaining, like a field's rules and like a route:

  ```ts
  Field.url()
  	.label("URL")
  	.describe("An http or https address")
  	.control({ placeholder: "https://" })
  	.max(300);
  ```

  - **Fields from a shape:** `route.fields(shape)` is the one way to give a route fields, and `Form` is internal. A route renders them with `Field`, `Fields`, and `component`, and no longer has the form's `parse`, `shape`, `names`, `parts`, `extend`, `pick`, and `omit`. To share fields, reuse the shape object, typed `Field.Shape`. Parsed fields are typed `Field.Parse.Data<typeof shape>`, and a form's kept values `Field.Value` and `Field.State`. `Form.from()` and `Route.Schema` are removed, and a field's own `render()` and `component()` are no longer part of the API.
  - **Label, description, and attributes:** `label()` names the field, and the `label` property is removed. `describe()` says how to fill it in: people see it in a paragraph under the control, which the control names in `aria-describedby`, and `component()` has a `Description` part to place it in a custom layout. `control()` gives the control its attributes. The object each field took is removed: `Field.text({ placeholder: "Name" })` becomes `Field.text().control({ placeholder: "Name" })`, and `Field.select(options, attributes)` becomes `Field.select(options).control(attributes)`. Each of the old forms is a type error. A table's field carries all three into every form and tool that uses it.
  - **Choices:** a field's choices are its `options`, as the `<option>` elements they render, so `values` means only a record's values: `field.options`, and `options` on a select's, a radio group's, or a checkbox group's components.
  - **Many values:** `multiple()` takes more than one value, chained like a field's other rules: `Field.file().multiple()` and `Field.select(options).multiple()` replace `Field.files()` and `Field.multiselect(options)`. `Field.checkboxes()` and `Field.radio()` stay, since each is a group of controls.
  - **Editing a record:** route forms and fields accept `values`, under any values restored from an invalid submission. Valid `c.data()` results add `invalid(messages)` to put issues found after parsing, such as a database constraint, on fields. Cleared persisted fields stay empty in invalid form state, so they stay cleared over initial values.
  - **Submit button:** a route's `Form` renders its fields, if any, and a submit button labelled with `submit`, so one without fields, such as a delete, is no longer empty; children replace both.
  - **Filling from the URL:** only a GET route's form fills its fields from search params of the same name. Other forms restore just the values they persisted in `_form`, so a link such as `/account/edit?role=admin` can no longer fill in a form, its hidden and password fields included, over the `values` passed to it.
  - **Required:** generated controls are `required` when leaving them empty fails validation, except checkboxes, so browsers, screen readers, and agents reading Markdown know before submitting. Pass `required={false}` to leave it out.
  - **Messages:** radio, select, and checkbox fields say "Select an option" when nothing or an option that is not offered is sent, instead of "Required field". Field names such as `constructor` are unexpected fields, not inherited properties.
  - **Numbers:** `Field.number()` and `Field.range()` reject integers beyond `Number.MAX_SAFE_INTEGER` instead of rounding them.

- fc30a95: Schemas describe themselves as JSON Schema, and parse about twice as fast.

  - **JSON Schema:** `schema.toJsonSchema()` and Standard JSON Schema support through `~standard.jsonSchema`, targeting draft 2020-12 or draft-07. A field's label is its `title`, and a `Field.checkbox()` is optional in input schemas, with a default of `false`, as an unchecked box is left out of a form.
  - **Descriptions:** `describe()` is a method of every schema: `Schema.string().uuid().describe("The bookmark's ID")` is that value's `description` in its JSON Schema, so a route's `params` describe a tool's arguments to agents. A field inherits it, and also shows the text under its control. `schema.description` reads it back, through what wraps it, such as `optional()`.
  - **New schemas:** `Schema.date()` and `.uuid()`. Schemas keep the definition they were built from in `schema.def`.
  - **Issue types:** declaration files name `Schema.Issue` and `Schema.AggregateIssue`, where they copied their members.
  - **Construction:** `new Schema(def)` and `schema.derive()` are protected, so a schema is made with `Schema`'s static methods.
  - **Strings:** `min` and `max` count Unicode characters instead of UTF-16 code units, matching JSON Schema and Postgres, so an emoji counts as one character.
  - **Speed:** nested schemas share one issue path, copied only into issues, and build one `Schema.AggregateIssue`.
  - **Fixes:** a `__proto__` key is kept as data, in an object's shape, passed through by `loose()`, or named by `pick` or `omit`, instead of changing the parsed object's prototype, and is an own property in JSON Schema. Unions and arrays with very many issues no longer overflow the stack. The published types compile without Node's types.

  The unused `Schema.Parse.Constructor` type is removed.

- fc30a95: Elements render to markup with `Markup` and to Markdown with `Markdown`, several times faster.

  - **`Render` is `Markup`:** it renders HTML and other markup such as XML. `Render.html` is `Markup.raw`, `Render.Options` is `Markup.Options`, and `Render.Chunk` is `Markup.Chunk`. The `safe` option is `raw`, like `Markup.raw`. `Markup.string(element)` is static, like `Markup.stream`, and declaration files name `Markup.Chunk`.
  - **Strings:** `Markup` yields strings of markup, as `Markdown` yields strings of Markdown, instead of chunks to call `toString()` on.
  - **JSX:** `JSX` is exported as a type only. The JSX runtime is `ovr/jsx-runtime`, which TypeScript and bundlers load from `jsxImportSource`. A class is a type error as a JSX tag, where it compiled and failed when rendered. SVG `<linearGradient>` and `<radialGradient>` accept their `<stop>` children.
  - **Markdown:** `Markdown` renders any element to Markdown, as an async iterable, `Markdown.stream`, or `Markdown.string`, written from the rendered elements as they stream, without parsing HTML. Requests that prefer `Accept: text/markdown` receive pages as Markdown, and `c.md(source)` responds with a page's own Markdown, such as a post's source, when it is asked for. HTML responses include `Vary: Accept`. Only the page's `<main>` is written when there is one, found inside any wrapper, and HTML from `Markup.raw` is written as it is.
  - **Markdown forms:** forms are written with their fields, values, and errors, and say how to encode their body, such as `POST https://example.com/todos` as `multipart/form-data`. A form in a table's cell is kept: one that is only a button, such as a delete in each row, is written in the cell, and one with fields after the table. A form around a table keeps the table and its links, with each control named in its cell. A button with a `formaction` says where it submits, and a `<pre>`, a link, and raw markup in a form are kept as they are.
  - **Markdown structure:** an inline element that holds blocks, such as a custom element around a card, is read as a container, so its headings, lists, code, and forms are kept. A code block in a `<dd>` or `<figcaption>` keeps its lines. Raw markup is its own block only when it starts with a block element, so `Markup.raw("&euro;")` stays in its sentence. A list keeps items inside a wrapper element and a list placed directly in a list, and paragraphs in one item stay apart.
  - **Markdown escapes:** text loose in a form, a backtick in a form's action, a run of `~`, a `>` or a line of `=` at the start of a line, and a character reference such as `&amp;` are escaped. An ordered list marker in text is escaped after its number (`1\.`), where the escape works.
  - **Speed:** a page renders to HTML about 9 times faster and to Markdown about 5 times faster: the renderer walks the tree with its own stack and only awaits what has to be awaited. A request for a small page through `App.fetch` goes from about 4,700 to 37,000 a second. A streamed response sends what is ready together, up to 2 KB for each read, where each element was a chunk of its own. The bytes and their order are the same, and nothing is held back for something that is still loading.
  - **Fixes:** a chunk rendered while an earlier sibling is still rendering is no longer changed, so a `Markup.raw()` value used in more than one place renders the same each time. `Markup.raw("")` in a streamed page is skipped, where it ended the stream with an error. A long table read as Markdown holds less than half of the memory it did until the table ends.

- fc30a95: The multipart parser is named `multipart` wherever it appears, so "form" means a route's fields and the `<form>` they render: `c.form()` is `c.multipart()`, and `new App({ form })` is `new App({ multipart })`.

  - **Errors:** the errors are `Multipart.Limit`, `Multipart.Malformed`, and `Multipart.Unsupported`, so a route that catches them can tell them apart from its own errors. They and `Multipart.Part` are types too, which declaration files name, so an app that exports a function returning a part or checking an error builds its declarations. A body the client got wrong is answered instead of thrown out of `app.fetch` when the route does not catch it: 413 for a body over a limit, 415 for a content type other than multipart form data, and 400 for malformed form data. Global middleware that catches errors sees the answer and not the error, so an error page is not shown for a client's mistake, and the answer keeps the headers middleware set, such as for CORS.
  - **Not a `Request`:** `Multipart` no longer extends `Request`, since it reads the request's body and every body method it inherited threw. It is the async iterable of a request's parts, with `data()`; read the request's headers and URL from the request. Each `Multipart.Part` is still a `Request`, whose body is the part's.
  - **Other servers:** form submissions work on servers that pass their own request object, such as srvx. The parser copied the request with the platform's constructor, which only accepts its own requests, so `c.data()` threw on every POST there.
  - **Parsing:** the parser skips the rest of a part its reader stopped reading, so a file's bytes are never parsed as further fields. A part that ends without its boundary, a body without the closing delimiter, and one without an opening boundary are malformed; a form without fields, only the closing delimiter, still parses. Only a delimiter starting the body or a line opens the first part, a line in a part that starts with the boundary rejects the body, as RFC 2046 does not allow it, and nothing after the closing delimiter is parsed. Spaces and tabs after a delimiter are ignored, as RFC 2046 requires of receivers.
  - **Boundaries:** boundaries must be 1 to 70 RFC 2046 characters; a boundary of 252 or more characters made parsing loop forever. Boundary searches are linear whatever boundary the client chooses.
  - **Headers:** quoted header parameters can contain `;` and escaped quotes, and decode only `%22`, `%0D`, and `%0A`, the escapes browsers write in filenames, so a file named `100%41.txt` keeps its name. Field names and filenames keep the UTF-8 browsers send, such as `レポート.pdf`, and a part header that is not UTF-8 is malformed.
  - **Memory:** a request or response body read whole is no longer held twice as it is joined.

- fc30a95: Mistakes in your own code are type errors instead of runtime checks, so they are found while you write the code and cost nothing at runtime:

  - `new Auth()` needs `Auth.tables` and its users table in its database, a users table with an `id` and without the `credential`, `ceremony`, or `bootstrap` fields passkey forms send.
  - `new Limiter()` needs `Limiter.table` in its database.
  - `c.redirect(route)` needs a route without parameters; use `route.url({ params })`.
  - `new Table()` needs a name, and `default` lists its own columns. An empty table, column, or schema name, or one with a NUL character, is a type error too, as is a column that may be left out, with `optional()` or `nullish()`; use `nullable()` or the `default` option.
  - A route pattern written out must start with `/`, and cannot hold a query, a fragment, or whitespace, and an MCP endpoint `path` must be a fixed path of the app's own.
  - `params()` or `fields()` called after `use()`. `use()` returns the route with neither, since its middleware is typed by them.
  - An Auth `page`, `redirect`, or `consent` path that is not a local path of the app's own, such as `https://example.com`, `/login?next=1`, or `/login/`, and a `page` that is one of Auth's endpoints. A path that is not written out, such as one read from the environment, is taken as it is.
  - A route pattern cannot run a parameter into the wildcard, as in `/:id*`, since nothing tells where one ends and the other starts; use `/:id/*`.
  - `route.describe()` needs text that is not blank, whatever whitespace it holds, and a pattern without both a `:wildcard` parameter and a `*` wildcard, which would both be the tool's `wildcard` argument.

  Checks stay at runtime where a type cannot see the value: options often read from the environment, such as Auth's origin and secret; values from requests, files, or the database; what else is mounted; and mistakes that would open a hole for an attacker, such as calling `sql` with a string instead of a template.

  Numbers in options are not checked, such as a `Limiter`'s `limit` and `interval` or Auth's session times, so a value read from the environment needs to be a number that makes sense.

### Minor Changes

- fc30a95: Apps are usable by AI agents, through MCP, WebMCP, and pages read as Markdown.

  - **MCP:** `app.use(new Mcp({ instructions }))` serves a Model Context Protocol endpoint at `/mcp`, implementing the 2026-07-28 Streamable HTTP transport, and the earlier 2025-11-25 and 2025-06-18 versions clients such as ChatGPT's start with `initialize`, all without sessions. It is tested with the official MCP conformance suite. Requests from another `Origin` are rejected, as is a browser request that reaches the endpoint from the same machine for a host that is not local, when the server passes the client's `ip` to `app.fetch`. Request IDs are strings or integers, and `Mcp-Method` and `Mcp-Name` headers must match the request. A request missing `protocolVersion` or `clientCapabilities` in `_meta` is an invalid params error (-32602) with status 400, a version header that differs from the body is a header mismatch, and `ping` and `initialize`, which 2026-07-28 removed, are not found on that version.
  - **Tools and resources:** only described routes are served, so adding a route or page never lets agents call or read it. A route becomes a tool, with an input schema from its parameters and fields, and described GET routes are Markdown resources. `route.tool` is the name, description, and hints agents call it with. A tool call runs the route's handlers as a request: arguments become form data or search parameters, and parameters fill the path anywhere in a segment.
  - **Input schemas:** a form's tool takes no other arguments, and one it does not have is an issue naming it. A number field lists with its type and rules, such as `integer` with a `minimum`, and as required when it is. A date, time, month, week, or color field describes the format its picker sends, such as `YYYY-MM-DD`. A file field's argument is the file's `name`, an optional media `type`, and its contents as `text`, or as `base64` when it is not text, and the route receives it as a `File` like one a browser uploads. A request to the endpoint is limited by the app's `multipart.memory`, 4 MB by default.
  - **Results:** form issues, and parameters a route's `params` schema rejects, are returned to the agent as issues. Redirects to described pages are followed; a redirect to another page of the app returns only that it redirected, keeping its address private, and one to another site returns its URL. A write that redirects is done: when the page it redirects to cannot be read, such as on a rate limit, the result says so without being an error, so an agent does not repeat the write. A refused request's `Retry-After` is included. A route that answers with a file returns an image or audio as its own content, and any other type, such as a PDF, as an embedded resource, or a `blob` from `resources/read`. A route that answers with an event stream returns the stream's address as a resource link, for the agent to open and close itself.
  - **Errors:** an answer with a status of 500 or more is a JSON-RPC internal error (-32603), and an error nothing in the app catches still leaves `app.fetch`, as from any route. A resource read the app refuses, such as with a 403, is an error about the request (-32602) with its status, and a missing resource is an invalid params error that names its URI.
  - **Pages for agents:** a page an agent reads through MCP gives each form as the call to its tool, with the arguments the form's address holds and the form's current values, including hidden ones, and messages: ``Delete ovr: tool `post_bookmarks_id_delete`, `id`: `0b8f5d0a` ``. A single checkbox's value is `true` or `false`. A form that submits to a route that is not described is left out, since the agent has no tool to submit it with. Pages read as Markdown over HTTP give the form's address instead. `resources/read` results carry `ttlMs` and `cacheScope`, private when agents sign in.
  - **Language:** an MCP client's language preference reaches the route a tool or resource runs as `Accept-Language`, from the request's `_meta` or its header, and the route's `Content-Language` is reported in the result's `_meta` and the response header.
  - **Outside middleware:** the endpoint runs outside the app's global middleware, and the request it makes to a route for each tool call or resource read passes through global middleware once, as the agent's user, so a `Limiter` passed to `app.use` counts each call once. The endpoints an agent signs in through run outside global middleware too: both metadata documents, `/oauth/authorize`, and `/oauth/token`, each still refusing a request for another host. The protected resource metadata names the endpoint at Auth's configured origin, where it named whatever host the request used.
  - **WebMCP:** a route's `Form` adds the declarative WebMCP attributes, `toolname`, `tooldescription`, and, for GET forms only, `toolautosubmit`, so agents in the browser call it as the same tool and the user submits forms that change data. Forms of routes with parameters and of undescribed routes are not annotated.
  - **Agent sign in:** with `new Mcp({ auth })` and a consent page, `/connect` by default, agents sign in through OAuth 2.1 with PKCE: the user approves the agent with their passkey, asked for again on Allow, where the browser offers only that user's passkeys, so a script driving a signed-in browser cannot approve it, and the agent's tool calls act as that user through `c.session()`. Authorization errors are answered with a 400 page, never redirected to the agent, and browser preflights for the OAuth endpoints are answered. With `auth`, a page's resource name is `page://host/path`, since the specification keeps `https` names for what an agent can fetch itself; `resources/read` takes either form.
  - **Agent identity:** agents identify themselves with client ID metadata documents, written exactly as their URL and fetched only from public addresses, which requires Node.js or Bun. A document that declares token endpoint authentication other than `none`, or grant or response types other than `authorization_code` and `code`, is not accepted, and a token request that authenticates its client is refused with `invalid_client`. Downloads are limited per IP, per document host, and at once, two per IP, with IPv6 counted per /64; requests for the same agent share one download, found agents are kept for 5 minutes, and a client ID without a valid document is remembered for a minute. When a download is refused, or fails in a way that may pass, an agent found in the last hour is served from its last document.
  - **Tokens:** Auth stores hashed tokens, bound to the exact MCP endpoint, in a table Auth's migration creates. A connection ends 30 days after approval, however often its tokens are refreshed. A used code or refresh token is kept until its tokens expire, so using it again revokes them. The code exchange needs `redirect_uri` when the authorization request named it. `auth.consent(c)` returns the request, whose `client` has the agent's `id`, its metadata document URL, and `name`, and `auth.disconnect(c, client)` revokes an agent's tokens, including ones a refresh is issuing at the same time.
  - **Memory:** a tool call builds only the tool it calls, about 0.1 MB and 0.1 ms for an app with 1,000 tools. A file sent to a tool is held once inside the route, and the request's bytes are let go before its JSON is parsed.

- fc30a95: Passkey authentication and rate limiting, stored in the application's Postgres database.

  - **Auth:** mounted with `app.use(auth)`, with registration, login, logout, revocable sessions read with `c.session()` that renew while used, up to their `lifetime`, and customizable forms whose message parts are `Register.Issue` and `Login.Issue`, as a field's is its `Issue`. Accounts are created in the application's users table, and Auth's own tables come from `Auth.tables`, whose versioned migrations `database.migrate` applies before the application's. `/login` is the default combined login and account creation page.
  - **Ceremonies:** registration fields are bound to stored challenges, and outstanding ceremonies are limited per browser. Browsers without WebAuthn's JSON helpers are told passkeys are unavailable before any challenge is requested. Signing secrets rotate, and a signature is accepted only in the spelling it was issued in.
  - **Limits:** sign-in is limited per client with fixed limits. `Limiter` rate limits your own routes, each limiter named by its first argument, with buckets stored under a hash of their name, policy, scope, and identity. `Limiter.Context` includes `session`, so a `key` can count each signed-in user. An unavailable limiter throws to the app instead of admitting the request.
  - **Client IP:** `App.fetch` takes the trusted client IP from the server.

- fc30a95: Add `Table` and `Database` for Postgres:

  - **Tables** are defined with schemas or form fields. Dates inside JSON columns are stored as ISO strings and read back as dates, in union branches too.
  - **Queries:** `database.sql` queries with bound parameters and validated rows. `Database.unique(error, constraint)` recognizes unique violations, for example to show them as form errors.
  - **Transactions:** pass `database.sql` a callback. Queries the callback did not wait for finish before the commit, so one that fails rolls the transaction back.
  - **Migrations:** SQL migrations with checksums and locking, each committed with its history record in one transaction, so `BEGIN`, `COMMIT`, and `ROLLBACK` are not allowed in them. The migrations of library tables such as `Auth.tables` are applied first, in the order each library lists them.
  - **Checks:** `database.check()` is a basic compatibility check of the live database's columns, and of the foreign keys library tables need, such as Auth's to the users table.

  Applications supply a pg-compatible pool.

## 6.2.5

### Patch Changes

- 002cac3: Improve rendering and multipart parsing performance:

  - Forward already-rendered HTML chunks directly from generators, avoiding redundant Render instances and async iterator delegation. A benchmark rendering 500 sibling JSX elements took about **19% less time** (1.34 → 1.08 ms).
  - Compact the multipart buffer only when more space is needed, avoiding repeated copies of unread bytes after each delimiter. Parsing 1,000 × 1 KiB fields received in 1 MiB chunks took about **54% less time** (26.8 → 12.4 ms), or **2.15× throughput**.
  - Scan incoming file bytes directly, copying output into independent storage or a BYOB destination and preserving unread bytes before yielding control. This retains Request parts and byte-stream behavior. Consuming a 10 MiB file with a reusable 64 KiB BYOB destination took about **39% less time** than the compaction-only version (3.30 → 2.02 ms), averaged across forward and reverse parser orders. Default-reader timings varied between runs; the field workload was roughly unchanged.

  These are local Node 24.19.0 benchmark results; gains depend on the workload.

## 6.2.4

### Patch Changes

- 15bd7fe: Improve parallel rendering performance by scheduling generator reads through a settled-result queue instead of repeatedly racing every active child. Compiled Vitest benchmarks on Node 26 render 10 sibling elements 1.6x faster, 100 sibling elements 3.8x faster, and 500 sibling elements 13x faster.

  Removing redundant promise wrapping and completed-generator cleanup improves the settled-result queue by another 1.1x with 10 or 100 siblings and 1.13x with 500 siblings. Returning fragment children directly makes a 100-fragment render 1.28x faster, while a mixed 500-component render improves 1.06x.

- 15bd7fe: Improve server request routing by passing an incoming `Request` directly when no `RequestInit` overrides are supplied instead of cloning it. Compiled Vitest benchmarks on Node 26 measure 1.5x higher throughput (about 34% lower latency) across a 12-request routing workload.
- 15bd7fe: Improve route matching performance by traversing the trie with pathname offsets instead of allocating a new substring for each node. Compiled Vitest benchmarks on Node 26 measure direct trie matching approximately 7–8% faster.
- a18009e: Improve TypeScript 7 compatibility by accurately typing optional values forwarded internally with `exactOptionalPropertyTypes`. Optional properties remain omittable and now also accept an explicitly forwarded `undefined` where supported.

## 6.2.3

### Patch Changes

- 44224ef: Fix `Schema.optional()`, `Schema.nullable()`, and `Schema.nullish()` types for newer TypeScript inference.

  Fix JSX declaration emit for newer TypeScript versions so `ovr` builds without private field export errors.

- dd961e7: Fix `Render.stream()` generator cleanup and related TypeScript issues in `render`, `jsx`, and test files.

## 6.2.2

### Patch Changes

- a8c0f85: fix(schema): Fields that resolve to `undefined` are omitted from parsed object output instead of being returned as `key: undefined`. This makes `Schema.Infer` and `Form.Parse.Data` infer optional properties for optional fields.

## 6.2.1

### Patch Changes

- 8a5c7cd: fix(form): make `result.search` URLSearchParams-compatible

  The undocumented `result.search` value returned from invalid form parses is now exposed as a single-entry search params init (`[["_form", value]]`). This lets it work directly with `new URLSearchParams(...)`, route `url({ search })` helpers, and similar URL APIs without reshaping the value first.

- 6e5febf: fix(schema): avoid TS7056 on exported object schemas using mode helpers

  `Schema.object(...).strict()` and `Schema.object(...).loose()` now return the public object schema alias instead of exposing the concrete internal object schema type. This avoids declaration emit failures like TS7056 when exporting larger object schemas. The same return-type cleanup also applies to `pick()` and `omit()`.

## 6.2.0

### Minor Changes

- 9a1256d: feat: Redirect directly to a `Route` instead of having to call `Route.pathname()`

  ```tsx
  import { Route } from "ovr";

  const form = Route.get("/signup", () => {
  	// ...
  });

  const redirect = Route.post((c) =>
  	c.redirect(
  		form, // redirect to the route directly
  		303,
  	),
  );
  ```

- 9a1256d: feat(schema): add `Schema`, `Field`, and `Form` helpers for typed parsing and form rendering

  This adds a built-in schema layer for validating values, parsing search params and multipart form data with `c.data()`, and rendering forms with reusable field helpers.

  Highlights:
  - `Schema` for parsing, refinement, transformation, and object/array composition
  - `Field` and `Form` helpers for typed HTML controls and render-state handling
  - Support for persisted invalid form values and streamed multipart uploads

  Docs: https://ovrjs.com/07-schema

- 9a1256d: feat(multipart): `Multipart.Part` now has a `value` method to get the `FormDataEntryValue` from the part.

  ```ts
  for await (const part of new Multipart(req)) {
  	const formDataEntryValue = await part.value(); // string | File
  }
  ```

### Patch Changes

- 9a1256d: fix(router): throw on conflicting param names at the same path segment

  Adding sibling routes like `/:id` and `/:name` at the same segment now throws a conflict error instead of registering ambiguous parameter names.

- 9a1256d: fix(form): fail fast when `c.data()` is called after consuming `c.form()`

  `c.form()` no longer caches a multipart parser on the context. If the request body has already been consumed through `c.form()`, a later call to `c.data()` now throws immediately instead of reusing stale parser state.

- 9a1256d: fix(types): fix secure cookie type

## 6.1.0

### Minor Changes

- cf7d0ac: feat(jsx): Support XML rendering

  This adds support for rendering XML and returning XML from `Middleware`, [see SEO sitemap example here](https://ovrjs.com/demo/seo).
  - Declaration tag

  ovr will automatically add question marks into the XML declaration element.

  ```tsx
  <xml version="1.0" /> // <?xml version="1.0"?>
  ```

  - No XML void elements

  For example `<link>` tags are void elements in HTML (do not require a closing tag). ovr will now detect if the link has children to render it correctly.

  ```tsx
  <link href="style.css" /> // rendered as void element: <link href="style.css">
  <link>https://ovrjs.com</link> // rendered with closing tag and children: <link>https://ovrjs.com</link>
  ```

  - All markup types are now escaped be default

  In addition to HTML, if the `content-type` header is set to an `xml` type, the render contents will automatically be escaped.

### Patch Changes

- cf7d0ac: fix(types): `Context.json` no longer accepts `bigint` as an input since `bigint` cannot be passed into `JSON.stringify`.

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
