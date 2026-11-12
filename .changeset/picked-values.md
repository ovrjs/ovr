---
"ovr": patch
---

- A date, date and time, month, week, time, or color field checks its value's format, and that a date is a real day. Before, any text passed, so an agent's `11/12/2026` reached the handler and failed there. It now gets an issue such as "Enter a date as YYYY-MM-DD".
- A sign-in link lasts five minutes, and `auth.link` no longer takes `minutes`.
