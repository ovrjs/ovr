---
"ovr": patch
---

Fixes from a sixth review:

- **Agents:** a tool that redirects to a page agents cannot read no longer returns its address, which could carry a token. A redirect to another site still returns its URL. A tool argument its route's `params` schema rejects, such as an ID that is not a UUID, returns the issue, like form issues, instead of a bare 404. A resource URI with a username or password is not found. Describing a pattern with both `:wildcard` and `*` is a type error, since both would be the tool's `wildcard` argument, and so is a description of only whitespace.
- **Responses:** content returned with a `Content-Type` such as `Text/HTML` or `text/html ; charset=utf-8` is escaped as markup, since media types ignore case and spaces.
- **Forms:** radio, select, checkbox, and multiselect fields say "Select an option" when nothing or an option that is not offered is sent, such as by an agent, instead of "Required field". A route's `Form` without fields, such as a delete, renders its submit button, labelled with `submit`, instead of an empty form.
- **Multipart:** spaces and tabs after a delimiter are ignored, as RFC 2046 requires of receivers.
