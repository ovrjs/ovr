import "drab/prefetch/define";
import "drab/share/define";

if (document.querySelector("scroll-story")) {
	customElements.define(
		"scroll-story",
		(await import("@/client/scroll-story")).ScrollStory,
	);
}

if (document.querySelector("network-demo")) {
	customElements.define(
		"network-demo",
		(await import("@/client/network-demo")).NetworkDemo,
	);
}

if (document.querySelector("stream-demo")) {
	customElements.define(
		"stream-demo",
		(await import("@/client/stream-demo")).StreamDemo,
	);
}

if (import.meta.env.DEV) {
	const o = await import("ovr");

	async function Async() {
		return <p>Async</p>;
	}

	function* Component() {
		for (let i = 0; i < 500; i++) {
			yield (
				<div>
					{i}
					<Async />
				</div>
			);
		}
	}

	const render = new o.Markup(<Component />);

	const time = performance.now();
	for await (const _chunk of render);
	console.log(performance.now() - time);
}
