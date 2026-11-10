---
"ovr": minor
---

A request body the client got wrong is answered instead of thrown out of `app.fetch`, when the route does not catch it: 413 for a body over a limit, 415 for a content type other than multipart form data, and 400 for malformed form data. A route's own middleware can catch these errors to answer differently. Global middleware that catches errors sees the answer and not the error, so an error page is not shown for a client's mistake, and the answer keeps the headers middleware set, such as for CORS.

A form in a page read as Markdown says how to encode its body, such as `POST https://example.com/todos` as `multipart/form-data`, so an agent submitting it directly knows what to send.
