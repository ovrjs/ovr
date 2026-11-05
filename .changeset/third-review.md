---
"ovr": patch
---

Fixes from a third review:

- **Agent downloads:** an agent's last document is used for at most an hour when a download is refused, since its redirects could have changed. It is also used when the download fails in a way that may pass, a timeout, network error, 429 or 5xx, instead of refusing the agent for a minute. A final answer, such as a 404 or an invalid document, forgets the agent at once.
- **Routes:** `describe("")` is a type error, since an empty description would leave the route silently unserved.
- **Tokens:** a signature is accepted only in the spelling it was issued in.
- **Passkeys:** browsers without WebAuthn's JSON helpers are told passkeys are unavailable before any challenge is requested.
