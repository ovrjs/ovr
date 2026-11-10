import { baseline } from "./baseline.js";
import * as o from "ovr";
import { bench, describe, expect } from "vitest";

// the renderer when each element was a generator, before a render read them
const commit = "220a8d1fb1b3c37af53ded742f633b46b8c25d32";
const markup = baseline("markup", {}, commit);
const imports = { "../markup/index.js": markup };
const { Markup: MarkupBefore }: { Markup: typeof o.Markup } = await import(
	markup
);
const { JSX: JsxBefore }: { JSX: typeof o.JSX } = await import(
	baseline("jsx", imports, commit)
);
const { Markdown: MarkdownBefore }: { Markdown: typeof o.Markdown } =
	await import(baseline("markdown", imports, commit));

const options = { time: 2000, warmupTime: 1000, setup: () => global.gc?.() };
const origin = "http://localhost:5173";

/**
 * A small page: a heading, a paragraph with a link, a list, and a table.
 *
 * @param jsx The `jsx` of the renderer to measure
 * @param id Post ID
 * @returns The page
 */
function page(jsx: typeof o.JSX.jsx, id: string) {
	return jsx("html", {
		lang: "en",
		children: [
			jsx("head", { children: jsx("title", { children: "Post" }) }),
			jsx("body", {
				children: jsx("main", {
					children: [
						jsx("h1", { children: ["Post ", id] }),
						jsx("p", {
							children: [
								"Written by ",
								jsx("a", { href: "/users/1", children: "Ada & Grace" }),
								", who ",
								jsx("em", { children: "also" }),
								" wrote ",
								jsx("code", { children: "<ovr>" }),
								".",
							],
						}),
						jsx("ul", {
							children: Array.from({ length: 10 }, (_, i) =>
								jsx("li", {
									children: jsx("a", {
										href: `/posts/${i}`,
										children: `Post ${i}`,
									}),
								}),
							),
						}),
						jsx("table", {
							children: [
								jsx("thead", {
									children: jsx("tr", {
										children: [
											jsx("th", { children: "Name" }),
											jsx("th", { children: "Views" }),
										],
									}),
								}),
								jsx("tbody", {
									children: Array.from({ length: 10 }, (_, i) =>
										jsx("tr", {
											children: [
												jsx("td", { children: `Row ${i}` }),
												jsx("td", { children: i * 100 }),
											],
										}),
									),
								}),
							],
						}),
					],
				}),
			}),
		],
	});
}

const fields = {
	title: o.Field.text(),
	email: o.Field.email(),
	age: o.Field.number(),
	body: o.Field.textarea(),
	kind: o.Field.select(["note", "post", "link"]),
	published: o.Field.checkbox(),
};

let parsed: unknown;

const app = new o.App().use(
	o.Route.get("/text").use((c) => c.text("hello")),
	o.Route.get("/json/:id").use((c) => c.json({ id: c.params.id })),
	o.Route.get("/posts/:id").use((c) => page(o.JSX.jsx, c.params.id)),
	o.Route.get("/search")
		.fields({ q: o.Field.search(), page: o.Field.number() })
		.use(async (c) => {
			parsed = (await c.data()).data;
			c.text("ok");
		}),
	o.Route.post("/posts")
		.fields(fields)
		.use(async (c) => {
			parsed = (await c.data()).data;
			c.text("ok");
		}),
);

const agent = { headers: { accept: "text/markdown" } };

/** @returns A new multipart request, since a body is read once */
function submit() {
	const body = new FormData();
	body.set("title", "Hello, world");
	body.set("email", "ada@example.com");
	body.set("age", "36");
	body.set("body", "Some text for the body of the post. ".repeat(8));
	body.set("kind", "post");
	body.set("published", "on");
	return new Request(origin + "/posts", { method: "POST", body });
}

/**
 * @param stream Stream to read to its end
 * @returns Its text
 */
const text = (stream: ReadableStream) => new Response(stream).text();

expect(await (await app.fetch(origin + "/text")).text()).toBe("hello");
expect(await (await app.fetch(origin + "/json/7")).json()).toEqual({ id: "7" });
expect(await (await app.fetch(origin + "/posts/7")).text()).toContain(
	'<a href="/users/1">Ada &amp; Grace</a>',
);
expect(await (await app.fetch(origin + "/posts/7", agent)).text()).toContain(
	"[Ada & Grace](http://localhost:5173/users/1)",
);
expect((await app.fetch(submit())).status).toBe(200);
expect(parsed).toMatchObject({ title: "Hello, world", age: 36, kind: "post" });
expect((await app.fetch(origin + "/search?q=ovr&page=2")).status).toBe(200);
expect(parsed).toEqual({ q: "ovr", page: 2 });

// the same page, written the same, before and after
expect(await o.Markup.string(page(o.JSX.jsx, "7"))).toBe(
	await MarkupBefore.string(page(JsxBefore.jsx, "7")),
);
expect(await text(o.Markup.stream(page(o.JSX.jsx, "7")))).toBe(
	await text(MarkupBefore.stream(page(JsxBefore.jsx, "7"))),
);
expect(await o.Markdown.string(page(o.JSX.jsx, "7"))).toBe(
	await MarkdownBefore.string(page(JsxBefore.jsx, "7")),
);

describe("App.fetch end to end", () => {
	bench(
		"text route",
		async () => {
			await (await app.fetch(origin + "/text")).text();
		},
		options,
	);

	bench(
		"JSON route with a parameter",
		async () => {
			await (await app.fetch(origin + "/json/7")).text();
		},
		options,
	);

	bench(
		"small page as HTML",
		async () => {
			await (await app.fetch(origin + "/posts/7")).text();
		},
		options,
	);

	bench(
		"small page as Markdown",
		async () => {
			await (await app.fetch(origin + "/posts/7", agent)).text();
		},
		options,
	);
});

describe("small page to an HTML string", () => {
	bench(
		"before",
		async () => {
			await MarkupBefore.string(page(JsxBefore.jsx, "7"));
		},
		options,
	);

	bench(
		"after",
		async () => {
			await o.Markup.string(page(o.JSX.jsx, "7"));
		},
		options,
	);
});

describe("small page to an HTML stream", () => {
	bench(
		"before",
		async () => {
			await text(MarkupBefore.stream(page(JsxBefore.jsx, "7")));
		},
		options,
	);

	bench(
		"after",
		async () => {
			await text(o.Markup.stream(page(o.JSX.jsx, "7")));
		},
		options,
	);
});

describe("small page to a Markdown string", () => {
	bench(
		"before",
		async () => {
			await MarkdownBefore.string(page(JsxBefore.jsx, "7"));
		},
		options,
	);

	bench(
		"after",
		async () => {
			await o.Markdown.string(page(o.JSX.jsx, "7"));
		},
		options,
	);
});

describe("small page to a Markdown stream", () => {
	bench(
		"before",
		async () => {
			await text(MarkdownBefore.stream(page(JsxBefore.jsx, "7")));
		},
		options,
	);

	bench(
		"after",
		async () => {
			await text(o.Markdown.stream(page(o.JSX.jsx, "7")));
		},
		options,
	);
});

describe("form parsing through c.data()", () => {
	// what the benchmark itself spends on the request, to subtract
	bench(
		"build the multipart request only",
		async () => {
			await submit().arrayBuffer();
		},
		options,
	);

	bench(
		"multipart POST with 6 fields",
		async () => {
			await app.fetch(submit());
		},
		options,
	);

	bench(
		"GET with 2 search params",
		async () => {
			await app.fetch(origin + "/search?q=ovr&page=2");
		},
		options,
	);
});
