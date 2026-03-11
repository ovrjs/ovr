---
title: ovr
description: The Streaming Framework
---

Build server-rendered apps with JSX, routes, forms, and uploads, with HTML streamed as soon as it is ready.

## Introduction

Designed to optimize [Time-To-First-Byte](https://web.dev/articles/ttfb#what_is_ttfb), ovr evaluates components in parallel and streams HTML in order by producing an [`AsyncGenerator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator) of HTML that feeds directly into the streamed response.

For example, for the following component:

```tsx
function Component() {
	return <p>hello world</p>;
}
```

ovr generates three chunks of HTML:

```ts
"<p>"; // streamed immediately
"hello world"; // next
"</p>"; // last
```

## Asynchronous streaming

While this streaming is trivial for a paragraph, consider when a component is asynchronous:

```tsx
async function Username() {
	const user = await getUser(); // slow...

	return <span>{user.name}</span>;
}

function Component() {
	return (
		<p>
			hello <Username />
		</p>
	);
}
```

Instead of waiting for `Username` to resolve before sending the entire `Component`, ovr will send what it has immediately and stream the rest as it becomes available.

```ts
"<p>";
"hello ";
// streamed immediately

// for await (const chunk of Username()) { ...
"<span>";
"username";
"</span>";

"</p>";
```

## Render how browsers read

Web browsers are [built for streaming](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work#parsing), they parse and paint HTML as it arrives. [Most critically, the head](https://web.dev/learn/performance/understanding-the-critical-path#what_resources_are_on_the_critical_rendering_path) of the document can be sent immediately to start the requests for linked assets (JavaScript, CSS, etc.) and start parsing before the HTML has finished streaming.

<video aria-label="A video showing the network waterfall of a website loading. The HTML head element is streamed immediately, allowing JavaScript and CSS files to download while the rest of the HTML body streams in simultaneously." src="https://zsbsjhwuth2a2ck8.public.blob.vercel-storage.com/html-streaming-network-Owka5ZckQQIo791h0LQ771O5ZZV3Wb.mp4" autoplay loop muted loading="lazy" playsinline></video>

ovr's architecture gives you streaming server-side rendering out of the box. No hydration bundle, no buffering---just HTML delivered _in order_, as soon as it's ready.
