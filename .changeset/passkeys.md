---
"ovr": minor
---

`auth.passkeys(c)` lists the signed-in user's passkeys, and `auth.remove(c, id)` removes one, as `auth.agents(c)` and `auth.disconnect(c, id)` do for agents.

```ts
const passkeys = await auth.passkeys(c);
// [{ id, name, created, origin, synced }]

await auth.remove(c, id); // true when it was removed
```

`remove` keeps an account's last passkey, also when two are removed at once, and returns `false` then or for an ID that is not the user's. Both throw when nobody is signed in. They replace reading and deleting `auth_credentials` rows yourself.
