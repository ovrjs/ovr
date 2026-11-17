import { App } from "../app/index.js";
import { type JSX, jsx } from "../jsx/index.js";
import type { Middleware } from "../middleware/index.js";
import { Render } from "../render/index.js";
import { Route } from "../route/index.js";
import type { Context } from "./read.js";
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

test("a component given as a value is typed with or without the context", async () => {
	const Card = (props: { icon: JSX.Component<{ size: number }> }) =>
		jsx(props.icon, { size: 16 });
	const Plain = (props: { size: number }) => jsx("b", { children: props.size });
	const Reads = (props: { size: number }, c: Context) =>
		jsx("b", { children: [props.size, c.url.pathname] });

	expect(
		await read(() => [jsx(Card, { icon: Plain }), jsx(Card, { icon: Reads })]),
	).toBe("<b>16</b><b>16/page</b>");

	// @ts-expect-error other props
	void (() => jsx(Card, { icon: (props: { name: string }) => props.name }));
	// @ts-expect-error called without the context it may read
	void ((icon: JSX.Component) => icon({}));
	// one that takes no props
	expectTypeOf<() => string>().toExtend<JSX.Component>();
	// only for routes with these parameters, so not any component
	expectTypeOf<
		(props: {}, c: Context<{ id: string }>) => string
	>().not.toExtend<JSX.Component>();
});

test("a component's context reads the request, and cannot answer it", () => {
	void ((c: Context) => {
		c.cookie.get("theme");
		void [c.req, c.ip, c.url, c.params, c.route, c.session, c.memo];

		// @ts-expect-error a redirect is the route's to make
		c.redirect("/");
		// @ts-expect-error and a cookie its to set
		c.cookie.set("theme", "dark");
		// @ts-expect-error the response has begun
		void c.res;
		// @ts-expect-error
		c.html("");
		// @ts-expect-error
		c.etag("1");
		// @ts-expect-error the route parses the request
		void c.data();
	});

	// a handler's fits wherever a context is asked for
	expectTypeOf<Middleware.Context>().toExtend<Context>();
	expectTypeOf<Middleware.Context<{ id: string }>>().toExtend<
		Context<{ id: string }>
	>();
	expectTypeOf<Context>().not.toExtend<Middleware.Context>();
	// and a component is not given one
	expectTypeOf<
		(props: {}, c: Middleware.Context) => string
	>().not.toExtend<JSX.Component>();
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

test.each([
	["markup", {}, "<main><p>first</p><p>rows</p><p>rows</p></main>"],
	["Markdown", { accept: "text/markdown" }, "first\n\nrows\n\nrows\n"],
])("a page of %s streams as it shares a read", async (_name, headers, page) => {
	let finish!: (rows: string) => void;
	const load = vi.fn(
		() => new Promise<string>((resolve) => (finish = resolve)),
	);
	const Rows = async (_props: {}, c: Context) =>
		jsx("p", { children: await c.memo(load)() });
	const response = await new App()
		.use(
			Route.get("/page").use(() =>
				// Markdown is written as it renders once it is in a main element
				jsx("main", {
					children: [
						jsx("p", { children: "first" }),
						jsx(Rows, {}),
						jsx(Rows, {}),
					],
				}),
			),
		)
		.fetch(new Request("https://example.com/page", { headers }));
	const reader = response
		.body!.pipeThrough(new TextDecoderStream())
		.getReader();
	let text = "";

	// written before what the components wait for is there
	while (!text.includes("first")) text += (await reader.read()).value;
	expect(text).not.toContain("rows");
	expect(load).toHaveBeenCalledTimes(1);

	finish("rows");

	for (let part; !(part = await reader.read()).done;) text += part.value;
	expect(text).toBe(page);
	expect(load).toHaveBeenCalledTimes(1);
});
