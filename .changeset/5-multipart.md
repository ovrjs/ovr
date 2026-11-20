---
"ovr": major
---

The multipart parser is named `multipart` wherever it appears, so "form" means a route's fields.

```ts
// before
new App({ form: { memory } });
const parts = c.form();

// after
new App({ multipart: { memory } });
const parts = c.multipart();
```

**Changed**

- **Not a `Request`:** `Multipart` no longer extends `Request`. It is the async iterable of a request's parts, with `data()`; read the request's headers and URL from the request. Each `Multipart.Part` is still a `Request`.
- **Parts:** a body may have 1000 parts by default, where it had no limit. Set `parts` to change it. A limit set to `undefined` or `NaN`, such as from an unset environment variable, keeps its default.
- **Errors:** the errors are `Multipart.Limit`, `Multipart.Malformed`, and `Multipart.Unsupported`. Left uncaught by the route, ovr answers them: 413 for a body over a limit, 415 for another content type, and 400 for malformed form data. Global middleware that catches errors sees the answer and not the error.
- **Stricter parsing:** a part that ends without its boundary, a body without the closing delimiter or an opening boundary, a boundary line inside a part, and a part header that is not UTF-8 are malformed. A boundary must be 1 to 70 RFC 2046 characters.
- **Headers:** quoted parameters can hold `;` and escaped quotes, and decode only `%22`, `%0D`, and `%0A`, the escapes browsers write, so a file named `100%41.txt` keeps its name. Names and filenames keep the UTF-8 browsers send. Parameter names match in any case.
- **Empty names:** `data()` keeps a field with an empty name, as `request.formData()` does.

**New**

- **Other servers:** form submissions work on servers that pass their own request object, such as srvx.
- **Skipped parts:** the parser skips the rest of a part its reader stopped reading.
- **Memory:** a body read whole is no longer held twice as it is joined.
