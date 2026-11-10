---
"ovr": minor
---

A request body the client got wrong is answered instead of thrown out of `app.fetch`, when nothing in the app catches it: 413 for a body over a limit, 415 for a content type other than multipart form data, and 400 for malformed form data. Middleware that catches these errors still sees them first, and the answer keeps the headers middleware set before the error, such as for CORS.

A form in a page read as Markdown says how to encode its body, such as `POST https://example.com/todos` as `multipart/form-data`, so an agent submitting it directly knows what to send.
