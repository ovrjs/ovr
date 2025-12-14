---
"ovr": minor
---

feat(jsx): Support XML rendering

This adds support for rendering XML and returning XML from `Middleware`, [see SEO sitemap example here](https://ovrjs.com/demo/seo).

- Declaration tag

ovr will automatically add question marks into the XML declaration element.

```tsx
<xml version="1.0" /> // <?xml version="1.0"?>
```

- No XML void elements

For example `<link>` tags are void elements in HTML (do not require a closing tag). ovr will now detect if the link has children to render it correctly.

```tsx
<link href="style.css" /> // rendered as void element: <link href="style.css">
<link>https://ovrjs.com</link> // rendered with closing tag and children: <link>https://ovrjs.com</link>
```

- All markup types are now escaped be default

In addition to HTML, if the `content-type` header is set to an `xml` type, the render contents will automatically be escaped.
