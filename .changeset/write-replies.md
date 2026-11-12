---
"ovr": minor
---

An agent's tool call that writes and redirects to a page is answered with one line, such as `Redirected to /recipes`, and not the page it redirected to. A read still follows its redirect. An agent that needs the page reads it, so put what it needs after a write, such as a new record's ID, in the address.
