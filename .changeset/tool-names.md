---
"ovr": minor
---

A tool's name no longer ends with a hash when its pattern has punctuation: `/@:username` is `get_username`, where it was `get_username_1jl2rtc`, and `/api_keys` is `get_api_keys`. Two described routes whose names would then be the same, such as `/a/b` and `/a_b`, throw when the app starts, as other clashing names do. Only a name longer than 64 characters still ends with a hash.
