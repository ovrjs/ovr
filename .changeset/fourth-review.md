---
"ovr": patch
---

Fixes from a fourth review:

- **Agents:** browser preflights for the OAuth endpoints are answered instead of refused as cross-site. Download slots are counted per IPv6 /64, like rate limits, so rotating addresses cannot take more.
- **MCP:** a request ID must be a string or integer, so a request with any other ID is rejected before it runs. Tools fill parameters and wildcards that follow text in a segment, such as `/file-*`.
- **Routes:** `route.url()` fills parameters anywhere in a segment, such as `/file-:id`, and throws when a value would make the path start with `//`, which browsers read as another host.
- **Multipart:** a line in a part that starts with the boundary rejects the body, since RFC 2046 does not allow it, and nothing after the closing delimiter is parsed, even when the form has no fields.
- **Transactions:** queries the callback did not wait for finish before the commit, so one that fails rolls the transaction back and rejects it, instead of silently undoing writes it reported as done.
