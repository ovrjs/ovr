import { App } from "../app/index.js";
import { jsx } from "../jsx/index.js";
import type { Middleware } from "../middleware/index.js";
import { Render } from "../render/index.js";
import { Route } from "../route/index.js";
import type { Context } from "./index.js";
import { expect, expectTypeOf, test, vi } from "vitest";

/** Writes the path of the request it is rendered for */
const Path = (_props: {}, c: Context) => jsx("i", { children: c.url.pathname });

/**
 * @param page What the page at `/page` returns
 * @param headers Request headers
 * @returns The page's text
 */
const read = async (
	page: Middleware,
	headers: Record<string, string> = {},
): Promise<string> =>
	(
		await new App()
			.use(Route.get("/page").use(page))
			.fetch(new Request("https://example.com/page", { headers }))
	).text();

test("a component is given the context of the request it is rendered for", async () => {
	expect(await read(() => jsx(Path, {}))).toBe("<i>/page</i>");
});

test("wherever it is in the page", async () => {
	const Nested = () => jsx("p", { children: jsx(Path, {}) });
	const Waits = async () => jsx(Path, {});
	function* Yields() {
		yield jsx(Path, {});
		yield [jsx(Path, {}), Promise.resolve(jsx(Path, {}))];
	}
	async function* Streams() {
		yield jsx(Path, {});
	}

	expect(
		await read(() => [
			jsx(Nested, {}),
			jsx(Waits, {}),
			jsx(Yields, {}),
			jsx(Streams, {}),
			() => jsx(Path, {}),
		]),
	).toBe("<p><i>/page</i></p>" + "<i>/page</i>".repeat(6));
});

test("when the page is read as Markdown", async () => {
	expect(
		await read(() => jsx("p", { children: jsx(Path, {}) }), {
			accept: "text/markdown",
		}),
	).toBe("_/page_\n");
});

test("in content that is not markup", async () => {
	expect(
		await read((c) => {
			c.res.headers.set("content-type", "text/plain");
			return ["a < b ", jsx(Path, {})];
		}),
	).toBe("a < b <i>/page</i>");
});

test("in a render that is a child of the page", async () => {
	expect(
		await read(() =>
			jsx("div", { children: new Render({ markup: jsx(Path, {}) }) }),
		),
	).toBe("<div><i>/page</i></div>");
});

test("a render on its own gives the context it is given", async () => {
	const Link = (_props: {}, c: Context) =>
		jsx("a", { href: "?page=2", children: c.url.pathname });
	const page: Middleware = async (c) => {
		const element = () => jsx(Link, {});

		return c.json([
			await new Render({ markup: element() }, { context: c }).string(),
			// links resolve against the request
			await new Render({ markdown: element() }, { context: c }).string(),
			// unless a base is given
			await new Render(
				{ markdown: element() },
				{ context: c, base: "https://other.example/" },
			).string(),
		]);
	};

	expect(JSON.parse(await read(page))).toEqual([
		'<a href="?page=2">/page</a>',
		"[/page](https://example.com/page?page=2)\n",
		"[/page](https://other.example/?page=2)\n",
	]);
});

test("without one, it has no context to give", async () => {
	const Given = (_props: {}, c: Context) => String(c);

	expect(await new Render({ markup: jsx(Given, {}) }).string()).toBe(
		"undefined",
	);
	expect(await new Render({ markdown: jsx(Given, {}) }).string()).toBe(
		"undefined\n",
	);
});

test("components that read the same thing share one read", async () => {
	const friendsOf = vi.fn(async (user: string) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		return [`${user}'s friend`];
	});
	const Share = async (props: { user: string }, c: Context) =>
		jsx("p", { children: await c.memo(friendsOf)(props.user) });
	const Offer = async (props: { user: string }, c: Context) =>
		jsx("p", { children: await c.memo(friendsOf)(props.user) });
	const page: Middleware = async (c) => [
		// the page reads it too, before anything renders
		(await c.memo(friendsOf)("ross")).length,
		jsx(Share, { user: "ross" }),
		jsx(Offer, { user: "ross" }),
		jsx(Offer, { user: "sam" }),
	];

	expect(await read(page)).toBe(
		"1<p>ross's friend</p><p>ross's friend</p><p>sam's friend</p>",
	);
	expect(friendsOf.mock.calls).toEqual([["ross"], ["sam"]]);

	// not kept for the next request
	await read(page);
	expect(friendsOf).toHaveBeenCalledTimes(4);
});

test("memo keeps a result for each set of arguments", () => {
	const c = context();
	const add = vi.fn((a: number, b: number) => a + b);
	const count = vi.fn(() => add.mock.calls.length);

	expect(c.memo(add)(1, 2)).toBe(3);
	expect(c.memo(add)(1, 2)).toBe(3);
	expect(c.memo(add)(2, 1)).toBe(3);
	expect(c.memo(add)(1, 3)).toBe(4);
	expect(add).toHaveBeenCalledTimes(3);

	// none
	expect(c.memo(count)()).toBe(3);
	c.memo(add)(5, 5);
	expect(c.memo(count)()).toBe(3);
	expect(count).toHaveBeenCalledTimes(1);

	// the same function each time it is asked for
	expect(c.memo(add)).toBe(c.memo(add));
	expectTypeOf(c.memo(add)).toEqualTypeOf<(a: number, b: number) => number>();
});

test("memo compares arguments as === does", () => {
	const c = context();
	const keys = vi.fn((value: unknown) => String(value));
	const one = { id: 1 };

	c.memo(keys)(one);
	c.memo(keys)(one);
	// another object, though it holds the same
	c.memo(keys)({ id: 1 });
	expect(keys).toHaveBeenCalledTimes(2);

	// each of these is its own argument
	for (const value of [undefined, null, 0, "", false, "0"]) {
		c.memo(keys)(value);
		c.memo(keys)(value);
	}
	expect(keys).toHaveBeenCalledTimes(8);
});

test("memo shares a promise, and one that rejects", async () => {
	const c = context();
	let calls = 0;
	const load = async (fail: boolean) => {
		calls++;
		await Promise.resolve();
		if (fail) throw new Error("down");
		return "rows";
	};

	const first = c.memo(load)(false);
	expect(c.memo(load)(false)).toBe(first);
	expect(await Promise.all([first, c.memo(load)(false)])).toEqual([
		"rows",
		"rows",
	]);

	await expect(c.memo(load)(true)).rejects.toThrow("down");
	await expect(c.memo(load)(true)).rejects.toThrow("down");
	expect(calls).toBe(2);
});

test("memo runs a function that throws again", () => {
	const c = context();
	let calls = 0;
	const fail = () => {
		calls++;
		throw new Error("no");
	};

	expect(() => c.memo(fail)()).toThrow("no");
	expect(() => c.memo(fail)()).toThrow("no");
	expect(calls).toBe(2);
});

/** @returns The context of a request, as a page is given it */
function context() {
	let given!: Context;

	void new App()
		.use(Route.get("/").use((c) => void (given = c)))
		.fetch("https://example.com/");

	return given;
}
