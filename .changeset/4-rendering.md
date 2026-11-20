---
"ovr": major
---

Elements render to markup with `new Render({ markup })` and to Markdown with `new Render({ markdown })`, several times faster.

```tsx
// before
const html = await Render.string(<Page />);
const stream = Render.stream(<Page />);
Render.html("<b>trusted</b>");
Render.escape(text, true);

// after
const html = await new Render({ markup: <Page /> }).string();
const stream = new Render({ markup: <Page /> }).stream();
Render.raw({ markup: "<b>trusted</b>" });
Render.escape({ attr: text });
```

**Changed**

- **`Render`:** `new Render({ markup: element }, options)` replaces `new Render(element, options)`, and its `stream()` and `string()` replace the static methods. `Render.Options` is `Render.Options.Markup`, and its `safe` option is `raw`.
- **`Render.raw({ markup })`** replaces `Render.html(html)`.
- **`Render.escape`** takes `{ markup }` for an element's content and `{ attr }` for an attribute's value, where it took a second argument.
- **Strings:** a render yields strings instead of chunks to call `toString()` on.
- **JSX:** `JSX` is exported as a type only. The runtime is `ovr/jsx-runtime`, which TypeScript and bundlers load from `jsxImportSource`. A class is a type error as a JSX tag.

**New**

- **Markdown:** `new Render({ markdown: element })` renders any element to Markdown. A request that prefers `Accept: text/markdown` gets a page as Markdown, only its `<main>` when it has one, with forms written out with their fields, values, and errors.
- **Text for one audience:** `Render.raw({ markup, markdown })` renders the markup on pages and the Markdown for agents. `Render.escape({ markdown })` escapes text put into it.
- **Component context:** a component is given the request's `Context` as its second argument, so a page no longer passes `c` down. A render made outside a request takes it as the `context` option.
- **`JSX.Component<Props>`** types a component taken as a value.
- **Speed:** a page renders to HTML about 9 times faster. A request for a small page through `app.fetch` goes from about 4,700 to 37,000 a second.

**Fixed**

- **Unsafe attributes:** an attribute name that would break its tag is left out, as is a `javascript:` URL in `href`, `src`, `action`, `formaction`, `data`, or `xlink:href`. A tag name that is not one throws.
- **`Render.raw`:** a value used in more than one place renders the same each time, and an empty one no longer ends a streamed page with an error.
- **Elements:** `<script>` takes any `type`, such as `application/ld+json`, and SVG gradients accept their `<stop>` children.
