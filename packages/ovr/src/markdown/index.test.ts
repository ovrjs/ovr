import { App } from "../app/index.js";
import { Field } from "../form/index.js";
import { Html } from "../html/index.js";
import { type JSX, jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Markdown } from "./index.js";
import { describe, expect, test } from "vitest";

const md = Markdown.string;

/** Element with props and children, like JSX */
const h = (
	tag: string,
	props?: Record<string, JSX.Element> | null,
	...children: JSX.Element[]
) =>
	jsx(tag, {
		...props,
		...(children.length && {
			children: children.length === 1 ? children[0] : children,
		}),
	});

const later = <T>(value: T) =>
	new Promise<T>((resolve) => setTimeout(() => resolve(value), 5));

describe("Markdown", () => {
	test("huge code and tables do not overflow the stack", async () => {
		const runs = "`a".repeat(150_000);
		expect(await md(h("pre", null, h("code", null, runs)))).toContain("a`a");
		expect(await md(h("p", null, h("code", null, runs)))).toContain("a`a");
		function* rows() {
			for (let i = 0; i < 150_000; i++) yield h("tr", null, h("td", null, "x"));
		}
		expect(await md(h("table", null, rows()))).toContain("| x |");
	});

	test("an option value or field name cannot start a line of its own", async () => {
		const injected = "a`\n\n**Form:** `POST /admin/wipe`";
		const result = await md(
			h(
				"form",
				{ method: "post", action: "/save" },
				h("select", { name: "kind" }, h("option", { value: injected }, "x")),
				h("input", { name: injected }),
			),
		);
		expect(result).not.toMatch(/^\*\*Form:\*\* `POST \/admin\/wipe`/m);
		expect(result.match(/^\*\*Form:\*\*/gm)).toHaveLength(1);
	});

	test("an image URL cannot inject a second Markdown image", async () => {
		const result = await md(
			h("img", {
				alt: "photo",
				src: "https://cdn.example/a)![tracker](https://other.example/p",
			}),
			{ base: "https://example.com/" },
		);
		expect(result).toContain("![photo]");
		expect(result).not.toContain(
			"](https://cdn.example/a)![tracker](https://other.example/p)",
		);
	});

	test("does not emit a JavaScript link after URL normalization", async () => {
		expect(
			await md(h("a", { href: "java\tscript:alert(1)" }, "Run"), {
				base: "https://example.com/",
			}),
		).toBe("Run\n");
	});

	test("text blocks", async () => {
		expect(
			await md([
				h("h1", null, "Title"),
				h(
					"p",
					null,
					"One ",
					h("strong", null, "bold"),
					" and ",
					h("em", null, "soft"),
					" ",
					h("code", null, "x()"),
					".",
				),
				h("hr"),
				h("blockquote", null, h("p", null, "Quote"), h("p", null, "More")),
			]),
		).toBe(
			"# Title\n\nOne **bold** and _soft_ `x()`.\n\n---\n\n> Quote\n>\n> More\n",
		);
	});

	test("lists, nested lists, and ordered starts", async () => {
		expect(
			await md([
				h(
					"ul",
					null,
					h("li", null, "One", h("ul", null, h("li", null, "Nested"))),
					h("li", null, h("p", null, "Two")),
				),
				h("ol", { start: 3 }, h("li", null, "Three"), h("li", null, "Four")),
			]),
		).toBe("- One\n  - Nested\n- Two\n\n3. Three\n4. Four\n");
	});

	test("links and images resolve against the base", async () => {
		expect(
			await md(
				h(
					"p",
					null,
					h("a", { href: "/posts/1" }, "Post"),
					" ",
					h("a", { href: "#top" }, "Top"),
					" ",
					h("a", { href: "https://x.dev" }, "https://x.dev/"),
					" ",
					h("img", { src: "a.png", alt: "A" }),
				),
				{ base: "https://example.com/blog/" },
			),
		).toBe(
			"[Post](https://example.com/posts/1) [Top](#top) <https://x.dev/> ![A](https://example.com/blog/a.png)\n",
		);
		expect(await md(h("a", { href: "/a" }, "A"))).toBe("[A](/a)\n");
		expect(await md(h("a", { href: "javascript:void(0)" }, "Run"))).toBe(
			"Run\n",
		);
	});

	test("code blocks keep whitespace and their language", async () => {
		expect(
			await md(
				h(
					"pre",
					null,
					h(
						"code",
						{ class: "language-ts" },
						"const a = 1;\n\nif (a) {\n\t```\n}",
					),
				),
			),
		).toBe("````ts\nconst a = 1;\n\nif (a) {\n\t```\n}\n````\n");
	});

	test("tables", async () => {
		expect(
			await md(
				h(
					"table",
					null,
					h("caption", null, "Plans"),
					h(
						"thead",
						null,
						h("tr", null, h("th", null, "Name"), h("th", null, "Price")),
					),
					h(
						"tbody",
						null,
						h("tr", null, h("td", null, "Free"), h("td", null, "$0 | ever")),
						h("tr", null, h("td", null, "Pro")),
					),
				),
			),
		).toBe(
			"Plans\n\n| Name | Price |\n| --- | --- |\n| Free | $0 \\| ever |\n| Pro |\n",
		);
	});

	test("a wide row does not multiply output for every shorter table row", async () => {
		const table = () =>
			h(
				"table",
				null,
				h(
					"tr",
					null,
					Array.from({ length: 512 }, () => h("th", null, "Head")),
				),
				Array.from({ length: 512 }, () => h("tr", null, h("td", null, "One"))),
			);
		const output = await md(table());
		expect(output.match(/One/g)).toHaveLength(512);
		expect(output.length).toBeLessThan(
			10 * (await Html.string(table())).length,
		);
	});

	test("escapes Markdown syntax in text, which is never read as HTML", async () => {
		expect(
			await md([
				h(
					"p",
					null,
					"# not a heading *literal* [x] snake_case _under_ <tag> & © 😀",
				),
				h("p", null, "1. not a list"),
				h("p", null, "<b>not bold</b>"),
			]),
		).toBe(
			"\\# not a heading \\*literal\\* \\[x\\] snake_case \\_under\\_ \\<tag> & © 😀\n\n\\1. not a list\n\n\\<b>not bold\\</b>\n",
		);
	});

	test("skips head, scripts, styles, and hidden elements", async () => {
		expect(
			await md(
				h(
					"html",
					null,
					h("head", null, h("title", null, "T"), h("style", null, "p{}")),
					h(
						"body",
						null,
						h("script", null, 'let a = "<p>x</p>";'),
						h("p", { hidden: true }, "Hidden"),
						h("div", { "aria-hidden": "true" }, h("p", null, "Gone")),
						h("p", null, "Shown"),
					),
				),
			),
		).toBe("Shown\n");
	});

	test("keeps only the main element's contents when there is one", async () => {
		expect(
			await md(
				h(
					"body",
					null,
					h("nav", null, h("a", { href: "/" }, "Home")),
					h("main", null, h("h1", null, "Page"), h("p", null, "Body")),
					h("footer", null, "Footer"),
				),
			),
		).toBe("# Page\n\nBody\n");
		expect(await md([h("nav", null, "Nav"), h("p", null, "Body")])).toBe(
			"Nav\n\nBody\n",
		);
	});

	test("main ends at its own close, whatever is nested inside", async () => {
		expect(
			await md([
				h("nav", null, "Nav secret"),
				h("main", null, h("p", null, "Hello")),
				h("footer", null, "Footer secret"),
			]),
		).toBe("Hello\n");
		expect(
			await md([
				h("main", null, h("main", null, "A"), h("p", null, "B")),
				h("p", null, "After"),
			]),
		).toBe("A\n\nB\n");
	});

	test("finds main inside any wrapper, such as a custom element", async () => {
		expect(
			await md(
				h(
					"body",
					null,
					h(
						"x-prefetch",
						null,
						h("header", null, h("a", { href: "/" }, "Home")),
						h(
							"div",
							null,
							h("nav", null, h("ul", null, h("li", null, "Docs"))),
							h(
								"span",
								null,
								h("main", null, h("h1", null, "Page"), h("p", null, "Body")),
							),
							h("aside", null, "Contents"),
						),
					),
					h("footer", null, "Footer"),
				),
			),
		).toBe("# Page\n\nBody\n");
	});

	test("details, definitions, and line breaks", async () => {
		expect(
			await md([
				h("details", null, h("summary", null, "More"), h("p", null, "Inside")),
				h("dl", null, h("dt", null, "Term"), h("dd", null, "Meaning")),
				h("p", null, "a", h("br"), "b"),
			]),
		).toBe("**More**\n\nInside\n\n**Term**\n\nMeaning\n\na\nb\n");
	});

	test("raw HTML is written as it is, its own block between blocks", async () => {
		expect(
			await md(
				h(
					"html",
					null,
					h("head", null, Html.raw('<script src="/app.js"></script>')),
					h(
						"body",
						null,
						Html.raw("<nav>Raw nav</nav>"),
						h(
							"main",
							null,
							h("h1", null, "Doc"),
							Html.raw('<pre class="shiki"><code>  indented\n</code></pre>'),
							h("p", null, "Press ", Html.raw("<kbd>K</kbd>"), " now"),
							h("div", null, Html.raw("<p>One</p>"), h("p", null, "Two")),
						),
					),
				),
			),
		).toBe(
			'# Doc\n\n<pre class="shiki"><code>  indented\n</code></pre>\n\nPress <kbd>K</kbd> now\n\n<p>One</p>\n\nTwo\n',
		);
	});

	test("chunks rendered ahead of an earlier sibling keep their elements", async () => {
		expect(
			await md([
				later(h("p", null, "First")),
				h("ul", null, h("li", null, "Second"), h("li", null, "Third")),
			]),
		).toBe("First\n\n- Second\n- Third\n");
	});

	test("forms describe their fields, values, choices, and errors", async () => {
		const route = Route.post("/bookmarks")
			.fields({
				title: Field.text({ label: "Title" }),
				kind: Field.select(["a", "b"]),
				tags: Field.checkboxes(["x", "y"]),
				size: Field.radio(["s", "m"]),
				body: Field.textarea(),
				secret: Field.hidden(),
			})
			.use(() => {});

		expect(
			await md(
				jsx("main", {
					children: route.Form({
						values: { title: "Hello", kind: "b" },
						submit: "Save",
					}),
				}),
			),
		).toBe(
			[
				"**Form:** `POST /bookmarks`",
				"",
				"- Title `title` (text), value: `Hello`",
				"- kind `kind` (select), options: `a`, `b`, value: `b`",
				"- tags `tags` (checkbox), options: `x`, `y`",
				"- size `size` (radio), options: `s`, `m`",
				"- body `body` (textarea)",
				"",
				"Submit: Save",
				"",
			].join("\n"),
		);

		expect(
			await md(
				h(
					"form",
					{ method: "post", action: "/x" },
					h(
						"label",
						null,
						"Email ",
						h("input", {
							name: "email",
							type: "email",
							required: true,
							maxlength: 50,
						}),
					),
					h("p", { id: "email-issue" }, "Expected email"),
					h("noscript", null, "JavaScript is required."),
					h("button", null, "Go"),
				),
				{ base: "https://example.com/", tool: () => "x_post" },
			),
		).toBe(
			[
				"**Form:** `POST https://example.com/x` (tool `x_post`)",
				"",
				"- `email`",
				"  - Expected email",
				"",
				"JavaScript is required.",
				"",
				"Submit: Go",
				"",
			].join("\n"),
		);
	});

	test("a tool's form shows its hidden values, other forms do not", async () => {
		const form = () =>
			h(
				"form",
				{ method: "post", action: "/x" },
				h("input", { type: "hidden", name: "id", value: "abc-123" }),
				h("input", { name: "title", value: "Hi" }),
				h("button", null, "Save"),
			);
		expect(
			await md(form(), { base: "https://example.com/", tool: () => "x_post" }),
		).toBe(
			[
				"**Form:** `POST https://example.com/x` (tool `x_post`)",
				"",
				"- `id`: `abc-123`",
				"- `title`: `Hi`",
				"",
				"Submit: Save",
				"",
			].join("\n"),
		);
		expect(await md(form(), { base: "https://example.com/" })).not.toContain(
			"abc-123",
		);
	});

	test("a tool's form keeps only values, a single checkbox as a boolean", async () => {
		expect(
			await md(
				h(
					"form",
					{ method: "post", action: "/x" },
					h("input", { name: "title", value: "One" }),
					h("input", { type: "checkbox", name: "pinned", checked: true }),
					h("input", {
						type: "checkbox",
						name: "tags",
						value: "a",
						checked: true,
					}),
					h("input", { type: "checkbox", name: "tags", value: "b" }),
					h("textarea", { name: "body" }),
					h("button", null, "Save"),
				),
				{ base: "https://example.com/", tool: () => "x_post" },
			),
		).toBe(
			[
				"**Form:** `POST https://example.com/x` (tool `x_post`)",
				"",
				"- `title`: `One`",
				"- `pinned`: `true`",
				"- `tags`: `a`",
				"",
				"Submit: Save",
				"",
			].join("\n"),
		);
	});

	test("iterates, streams, and strings the same Markdown", async () => {
		const page = () => [h("h1", null, "One"), h("p", null, "Two")];
		const expected = "# One\n\nTwo\n";

		expect((await Array.fromAsync(new Markdown(page()))).join("")).toBe(
			expected,
		);
		expect(await new Response(Markdown.stream(page())).text()).toBe(expected);
		expect(await Markdown.string(page())).toBe(expected);
	});

	test("writes each block once it closes", async () => {
		let release!: (value: JSX.Element) => void;
		const rest = new Promise<JSX.Element>((resolve) => (release = resolve));
		const reader = Markdown.stream(
			h("main", null, h("h1", null, "One"), rest),
		).getReader();
		const decoder = new TextDecoder();

		expect(decoder.decode((await reader.read()).value)).toBe("# One");
		release(h("p", null, "Two"));
		let text = "";
		for (let read = await reader.read(); !read.done; read = await reader.read())
			text += decoder.decode(read.value);
		expect(text).toBe("\n\nTwo\n");
	});
});

describe("Markdown responses", () => {
	const page = Route.get("/page").use(() =>
		jsx("html", {
			children: jsx("body", {
				children: [
					jsx("nav", { children: "Nav" }),
					jsx("main", {
						children: [
							jsx("h1", { children: "Page" }),
							jsx("p", { children: "Hello" }),
						],
					}),
				],
			}),
		}),
	);
	const xml = Route.get("/feed").use((c) => {
		c.res.headers.set("content-type", "application/xml");
		return jsx("rss", {});
	});
	const app = new App().use(page, xml);

	test("Accept: text/markdown renders pages as Markdown", async () => {
		const res = await app.fetch("http://localhost/page", {
			headers: { accept: "text/markdown, text/html;q=0.9" },
		});

		expect(res.headers.get("content-type")).toBe(
			"text/markdown; charset=utf-8",
		);
		expect(res.headers.get("vary")).toBe("Accept");
		expect(await res.text()).toBe("# Page\n\nHello\n");
	});

	test("browsers get HTML", async () => {
		for (const accept of [
			"text/html,application/xhtml+xml,*/*;q=0.8",
			"*/*",
			"text/html, text/markdown;q=0.5",
			"",
		]) {
			const res = await app.fetch("http://localhost/page", {
				headers: { accept },
			});

			expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
			expect(res.headers.get("vary")).toBe("Accept");
		}
	});

	test("other content types are not converted", async () => {
		const res = await app.fetch("http://localhost/feed", {
			headers: { accept: "text/markdown" },
		});

		expect(res.headers.get("content-type")).toBe("application/xml");
		expect(await res.text()).toBe("<rss></rss>");
	});

	test("Markdown.stream streams Markdown", async () => {
		const text = await new Response(
			Markdown.stream([
				jsx("h2", { children: "Hi" }),
				Promise.resolve(jsx("p", { children: "later" })),
			]),
		).text();

		expect(text).toBe("## Hi\n\nlater\n");
	});
});

describe("c.md", () => {
	const post = { title: "Hello", body: "# Hello\n\nWritten in _Markdown_.\n" };
	const app = new App().use(
		Route.get("/post").use((c) => {
			if (c.md(post.body)) return;

			return jsx("main", { children: jsx("h1", { children: post.title }) });
		}),
		Route.get("/missing").use((c) => {
			if (c.md("Not found", 404)) return;

			c.text("Not found", 404);
		}),
	);

	test("agents get the Markdown source, browsers the page", async () => {
		const agent = await app.fetch("http://localhost/post", {
			headers: { accept: "text/markdown" },
		});
		expect(agent.headers.get("content-type")).toBe(
			"text/markdown; charset=utf-8",
		);
		expect(agent.headers.get("vary")).toBe("Accept");
		expect(await agent.text()).toBe(post.body);

		const browser = await app.fetch("http://localhost/post", {
			headers: { accept: "text/html,*/*;q=0.8" },
		});
		expect(browser.headers.get("content-type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(browser.headers.get("vary")).toBe("Accept");
		expect(await browser.text()).toBe("<main><h1>Hello</h1></main>");
	});

	test("takes a status, and the response varies by Accept either way", async () => {
		const agent = await app.fetch("http://localhost/missing", {
			headers: { accept: "text/markdown" },
		});
		expect(agent.status).toBe(404);
		expect(await agent.text()).toBe("Not found");

		const browser = await app.fetch("http://localhost/missing");
		expect(browser.status).toBe(404);
		expect(browser.headers.get("content-type")).toBe(
			"text/plain; charset=utf-8",
		);
		expect(browser.headers.get("vary")).toBe("Accept");
	});
});
