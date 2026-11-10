---
"ovr": patch
---

A wildcard param never starts with `/`: `/files//etc/passwd` gives `"etc/passwd"`, so joining it to a folder cannot leave the folder. Parameter names in `Content-Type` and `Content-Disposition`, such as `Boundary`, match in any case.
