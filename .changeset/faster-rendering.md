---
"ovr": patch
---

Rendering and multipart parsing are several times faster.

- A page renders to HTML about 9 times faster and to Markdown about 5 times faster. An element is no longer an async generator: the renderer walks the tree with its own stack and only awaits what has to be awaited. A request for a small page through `App.fetch` goes from about 4,700 to 37,000 a second.
- A streamed response sends what is ready together, up to 2 KB for each read, where each element was a chunk of its own. The bytes and their order are the same, and nothing is held back for something that is still loading.
- Multipart parsing of a large file is about 9 times faster, after a change to the boundary search had made it 4 times slower than before, and a form of many fields about 2 times faster.

`Markup.raw("")` in a streamed page is skipped, where it ended the stream with an error.
