---
title: Parallelization
description: Understand how ovr processes async components in parallel.
---

With ovr, every component is streamed independently allowing you to read this content immediately instead of waiting for the last component to render. The delay does not waterfall since components are generated in parallel with [`Promise.race`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race).

```tsx
async function Delay({ ms }: { ms: number }) {
	await new Promise((res) => setTimeout(res, ms));
	return <div>{ms}ms</div>;
}

function Delays() {
	const delays = Array.from({ length: 6 }, (_, i) => i * 100);
	return delays.map((ms) => <Delay ms={ms} />);
}
```

---
