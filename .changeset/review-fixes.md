---
"ovr": patch
---

- A list reads its rows in one pass. Before, a request with many rows cost the whole form again for every cell, so a large one could hold the server for seconds. A list also takes no more rows in one request than its `max()`, or 1,000 without one.
- A `_return` path with a tab or a new line in it, which a browser reads as another site, is not followed after sign-in.
- Form state in a URL shows no more rows of a list than it takes, and never sets a row's hidden value.
- The page a sign-in link opens is sent with `Referrer-Policy: no-referrer`.
- A file's name in an agent's tool result is only a name.
