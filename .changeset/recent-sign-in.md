---
"ovr": patch
---

Adding a passkey asks for a sign-in within the last ten minutes, in that browser. A passkey outlasts the session that adds it, so a session taken over later cannot make itself a permanent way in. After ten minutes the `Add` form first asks for a passkey the person already has, which starts their session again, and they press the button once more to add the new one.
