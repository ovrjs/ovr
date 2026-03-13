---
title: The Streaming Framework
description: Build server-rendered applications with HTML and web standards.
---

## Introduction

Designed to optimize [Time-To-First-Byte](https://web.dev/articles/ttfb#what_is_ttfb), ovr evaluates components in parallel and streams HTML in order by producing an [`AsyncGenerator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator) of HTML that feeds directly into the streamed response.

For example, for the following component, ovr generates three chunks of HTML:

<div class="grid sm:grid-cols-2 sm:gap-4 *:my-2">

```tsx hide
function Component() {
	return <p>hello world</p>;
}
```

```ts hide
"<p>"; // 1. streamed immediately
"hello world"; // 2. next
"</p>"; // 3. last
```

</div>

## Asynchronous streaming

While this streaming is trivial for a paragraph, consider when a component is asynchronous. Instead of waiting for `Username` to resolve before sending the entire `Component`, ovr will send what it has immediately and stream the rest as it becomes available.

<div class="grid sm:grid-cols-2 sm:gap-4 *:my-2">

```tsx hide
function Component() {
	return (
		<p>
			hello <Username />
		</p>
	);
}

async function Username() {
	// slow async work...
	const user = await getUser();

	return <span>{user.name}</span>;
}
```

```ts hide
"<p>";
"hello ";
// streamed immediately

// as soon as getUser() resolves
"<span>";
"username";
"</span>";

"</p>";
```

</div>

## Render how browsers read

Web browsers are [built for streaming](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work#parsing), they parse and paint HTML as it arrives. [Most critically, the head](https://web.dev/learn/performance/understanding-the-critical-path#what_resources_are_on_the_critical_rendering_path) of the document can be sent immediately to start the requests for linked assets (JavaScript, CSS, etc.) and start parsing before the HTML has finished streaming.

<video class="aspect-16/7.5 object-cover" aria-label="A video showing the network waterfall of a website loading. The HTML head element is streamed immediately, allowing JavaScript and CSS files to download while the rest of the HTML body streams in simultaneously." src="https://zsbsjhwuth2a2ck8.public.blob.vercel-storage.com/html-streaming-network-Owka5ZckQQIo791h0LQ771O5ZZV3Wb.mp4" autoplay loop muted loading="lazy" playsinline></video>

ovr's architecture gives you streaming server-side rendering out of the box. No hydration bundle, no buffering---just HTML delivered _in order_, as soon as it's ready.

## Constraints

ovr is intentionally constrained. These rules keep the framework small and shape the API.

- **No client JS required.** Everything should work when no client-side JavaScript runs.
- **Streaming first.** Responses and request parsing should start immediately, without buffering whole documents or uploads in memory.
- **Stateless by default.** Core APIs should not require server-side state to work correctly.
