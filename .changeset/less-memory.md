---
"ovr": patch
---

The MCP endpoint and the Markdown writer hold less memory.

- A tool call builds only the tool it calls. Every tool's JSON Schema was rebuilt for each call, which for an app with 1,000 tools was about 8 MB allocated and 4 ms; it is now about 0.1 MB and 0.1 ms.
- A file sent to a tool is held once inside the route, where it was held as the file and again as its base64 text, and the request's bytes are let go before its JSON is parsed.
- A long table read as Markdown holds less than half of what it did until the table ends.
- A request or response body read whole is no longer held twice as it is joined.
