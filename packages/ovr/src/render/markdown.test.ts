import { App } from "../app/index.js";
import { jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Field } from "../schema/index.js";
import { Render } from "./index.js";
import { Markdown } from "./markdown.js";
import { describe, expect, test } from "vitest";

const md = (html: string, options?: Markdown.Options) =>
	Markdown.convert(html, options);

describe("Markdown", () => {
	test("does not emit a JavaScript link after URL normalization", () => {
		expect(
			md('<a href="java&#9;script:alert(1)">Run</a>', {
				base: "https://example.com/",
			}),
		).toBe("Run\n");
	});

	test("text blocks", () => {
		expect(
			md(
				"<h1>Title</h1><p>One <strong>bold</strong> and <em>soft</em> <code>x()</code>.</p><hr><blockquote><p>Quote</p><p>More</p></blockquote>",
			),
		).toBe(
			"# Title\n\nOne **bold** and _soft_ `x()`.\n\n---\n\n> Quote\n>\n> More\n",
		);
	});

	test("lists, nested lists, and ordered starts", () => {
		expect(
			md(
				"<ul><li>One<ul><li>Nested</li></ul></li><li><p>Two</p></li></ul><ol start='3'><li>Three<li>Four</ol>",
			),
		).toBe("- One\n  - Nested\n- Two\n\n3. Three\n4. Four\n");
	});

	test("links and images resolve against the base", () => {
		expect(
			md(
				'<p><a href="/posts/1">Post</a> <a href="#top">Top</a> <a href="https://x.dev">https://x.dev/</a> <img src="a.png" alt="A"></p>',
				{ base: "https://example.com/blog/" },
			),
		).toBe(
			"[Post](https://example.com/posts/1) [Top](#top) <https://x.dev/> ![A](https://example.com/blog/a.png)\n",
		);
		expect(md('<a href="/a">A</a>')).toBe("[A](/a)\n");
		expect(md('<a href="javascript:void(0)">Run</a>')).toBe("Run\n");
	});

	test("code blocks keep whitespace and their language", () => {
		expect(
			md(
				'<pre><code class="language-ts">const a = 1;\n\nif (a) {\n\t```\n}</code></pre>',
			),
		).toBe("````ts\nconst a = 1;\n\nif (a) {\n\t```\n}\n````\n");
	});

	test("tables", () => {
		expect(
			md(
				"<table><caption>Plans</caption><thead><tr><th>Name</th><th>Price</th></tr></thead><tbody><tr><td>Free</td><td>$0 | ever</td></tr><tr><td>Pro</td></tr></tbody></table>",
			),
		).toBe(
			"Plans\n\n| Name | Price |\n| --- | --- |\n| Free | $0 \\| ever |\n| Pro |\n",
		);
	});

	test("a wide row does not multiply output for every shorter table row", () => {
		const html =
			"<table><tr>" +
			"<th>Head</th>".repeat(512) +
			"</tr>" +
			"<tr><td>One</td></tr>".repeat(512) +
			"</table>";
		const output = md(html);
		expect(output.match(/One/g)).toHaveLength(512);
		expect(output.length).toBeLessThan(10 * html.length);
	});

	test("escapes Markdown syntax in text and decodes references", () => {
		expect(
			md(
				"<p># not a heading *literal* [x] snake_case _under_ &lt;tag&gt; &amp; &#169; &#x1F600;</p><p>1. not a list</p>",
			),
		).toBe(
			"\\# not a heading \\*literal\\* \\[x\\] snake_case \\_under\\_ \\<tag> & © 😀\n\n\\1. not a list\n",
		);
	});

	test("skips head, scripts, styles, and hidden elements", () => {
		expect(
			md(
				'<!doctype html><html><head><title>T</title><style>p{}</style></head><body><script>let a = "<p>x</p>";</script><p hidden>Hidden</p><div aria-hidden="true"><p>Gone</p></div><p>Shown</p><!-- comment --></body></html>',
			),
		).toBe("Shown\n");
	});

	test("keeps only the main element's contents when there is one", () => {
		expect(
			md(
				"<body><nav><a href='/'>Home</a></nav><main><h1>Page</h1><p>Body</p></main><footer>Footer</footer></body>",
			),
		).toBe("# Page\n\nBody\n");
		expect(md("<nav>Nav</nav><p>Body</p>")).toBe("Nav\n\nBody\n");
	});

	test("details, definitions, and line breaks", () => {
		expect(
			md(
				"<details><summary>More</summary><p>Inside</p></details><dl><dt>Term</dt><dd>Meaning</dd></dl><p>a<br>b</p>",
			),
		).toBe("**More**\n\nInside\n\n**Term**\n\nMeaning\n\na\nb\n");
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

		const html = await new Render(null).string(
			jsx("main", {
				children: route.Form({
					values: { title: "Hello", kind: "b" },
					submit: "Save",
				}),
			}),
		);

		expect(md(html)).toBe(
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
			md(
				'<form method="post" action="/x"><label>Email <input name="email" type="email" required maxlength="50"></label><p id="email-issue">Expected email</p><noscript>JavaScript is required.</noscript><button>Go</button></form>',
				{ base: "https://example.com/", tool: () => "x_post" },
			),
		).toBe(
			[
				"**Form:** `POST https://example.com/x` (tool `x_post`)",
				"",
				"- Email `email` (email, required, maxlength 50)",
				"  - Expected email",
				"",
				"JavaScript is required.",
				"",
				"Submit: Go",
				"",
			].join("\n"),
		);
	});

	test("chunk boundaries do not change the output", () => {
		const html =
			'<main><h2 class="x">A &amp; B</h2><p>Text with <a href="/a?b=1&amp;c=2">a link</a></p><pre><code>x &lt; y</code></pre><ul><li>One</li></ul></main>';
		const whole = md(html);
		const markdown = new Markdown();
		let split = "";
		for (const char of html) split += markdown.write(char);
		split += markdown.end();

		expect(split).toBe(whole);
		expect(whole).toBe(
			"## A & B\n\nText with [a link](/a?b=1&c=2)\n\n```\nx < y\n```\n\n- One\n",
		);
	});

	test("writes each block once it closes", () => {
		const markdown = new Markdown();

		expect(markdown.write("<main><h1>One</h1><p>Two")).toBe("# One");
		expect(markdown.write("</p><ul><li>Three")).toBe("\n\nTwo");
		expect(markdown.end()).toBe("\n\n- Three\n");
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

	test("Render.markdown streams Markdown", async () => {
		const text = await new Response(
			Render.markdown([
				jsx("h2", { children: "Hi" }),
				Promise.resolve(jsx("p", { children: "later" })),
			]),
		).text();

		expect(text).toBe("## Hi\n\nlater\n");
	});
});
