---
"ovr": patch
---

Auth follows the newer client ID metadata document draft the next MCP revision requires. A document that declares only token endpoint authentication methods other than `none`, or grant or response types other than `authorization_code` and `code`, is not accepted, where the agent was treated as a public client regardless. A token request that authenticates its client, with a secret, an assertion, or an `Authorization` header, is refused with `invalid_client`.
