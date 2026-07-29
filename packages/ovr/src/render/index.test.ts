import { Render } from "./index.js";
import { expect, test, vi } from "vitest";

const deferred = () => {
	let resolve!: (value: string) => void;

	return { promise: new Promise<string>((r) => (resolve = r)), resolve };
};

test("escape content", () => {
	const escaped = Render.escape(`&<script>console.log("hello")</script>`);

	expect(escaped.includes("&amp")).toBe(true);
	expect(escaped.includes("<")).toBe(false);
});

test("escape attribute", () => {
	const escaped = Render.escape(`&<script>console.log("hello")</script>`, true);

	expect(escaped.includes("&amp")).toBe(true);
	expect(escaped.includes("<")).toBe(false);
	expect(escaped.includes('"')).toBe(false);
});

test("parallel children render in source order", async () => {
	const first = deferred();
	const second = deferred();
	const started: number[] = [];
	const render = new Render([
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
			new Render([
				async () => {
					throw new Error("failed");
				},
				sibling(),
			]),
		),
	).rejects.toThrow("failed");
	expect(closed).toBe(true);
});
