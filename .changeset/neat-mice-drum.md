---
"ovr": patch
---

fix(schema): Fields that resolve to `undefined` are omitted from parsed object output instead of being returned as `key: undefined`. This makes `Schema.Infer` and `Form.Parse.Data` infer optional properties for optional fields.
