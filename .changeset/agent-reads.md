---
"ovr": major
---

Agents read only described pages, and more fixes from a second review:

- **Agents:** only described routes are served through MCP. Undescribed GET pages are no longer resources, and tool redirects to them are not followed, so adding a page never lets agents read it. `describe(false)` is removed: leave a route undescribed instead.
- **Sign-in:** outstanding ceremonies are capped per browser only. The cap of 10,000 across all browsers is removed, since anyone with enough addresses could fill it and lock everyone out.
- **Agent downloads:** each request's own per-IP limit is checked before it joins a download, so one client's refusal is never another's. When a download is refused, an agent found in the last hour is served from its last document.
- **Multipart:** quoted parameters decode only `%22`, `%0D`, and `%0A`, the escapes browsers write in filenames, so a file named `100%41.txt` keeps its name.
