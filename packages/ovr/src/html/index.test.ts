import { JSX } from "../jsx/index.js";
import { Html } from "./index.js";
import { expect, test, vi } from "vitest";

const deferred = () => {
	let resolve!: (value: string) => void;

	return { promise: new Promise<string>((r) => (resolve = r)), resolve };
};

test("escape content", () => {
	const escaped = Html.escape(`&<script>console.log("hello")</script>`);

	expect(escaped.includes("&amp")).toBe(true);
	expect(escaped.includes("<")).toBe(false);
});

test("escape attribute", () => {
	const escaped = Html.escape(`&<script>console.log("hello")</script>`, true);

	expect(escaped.includes("&amp")).toBe(true);
	expect(escaped.includes("<")).toBe(false);
	expect(escaped.includes('"')).toBe(false);
});

test("fragment", () => {
	const children = ["Hello", ", world!"];
	expect(JSX.Fragment({ children })).toBe(children);
});

test("generators preserve trusted HTML and escape ordinary children", async () => {
	function* sync() {
		yield Html.raw("<b>trusted</b>");
		yield "<&";
	}
	async function* async() {
		yield Html.raw("<b>trusted</b>");
		yield "<&";
	}
	for (const element of [sync(), async()]) {
		expect((await Array.fromAsync(new Html(element))).join("")).toBe(
			"<b>trusted</b>&lt;&amp;",
		);
	}
});

test("parallel children render in source order", async () => {
	const first = deferred();
	const second = deferred();
	const started: number[] = [];
	const render = new Html([
		() => {
			started.push(1);
			return first.promise;
		},
		() => {
			started.push(2);
			return second.promise;
		},
	])[Symbol.asyncIterator]();
	const pending = render.next();

	await vi.waitFor(() => expect(started).toStrictEqual([1, 2]));

	second.resolve("second");
	first.resolve("first");

	expect(String((await pending).value)).toBe("first");
	expect(String((await render.next()).value)).toBe("second");
	expect((await render.next()).done).toBe(true);
});

test("parallel child errors close sibling generators", async () => {
	let closed = false;

	async function* sibling() {
		try {
			yield "sibling";
		} finally {
			closed = true;
		}
	}

	await expect(
		Array.fromAsync(
			new Html([
				async () => {
					throw new Error("failed");
				},
				sibling(),
			]),
		),
	).rejects.toThrow("failed");
	expect(closed).toBe(true);
});

test("a chunk rendered more than once is never changed", async () => {
	const star = Html.raw("★");
	const later = new Promise((resolve) => setTimeout(() => resolve("a"), 5));

	// the second child renders while the first waits, so its chunks are queued
	expect(await Html.string([later, [star, "b"]])).toBe("a★b");
	expect(await Html.string([star, star])).toBe("★★");
});
