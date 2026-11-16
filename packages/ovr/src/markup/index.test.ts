import { JSX } from "../jsx/index.js";
import { Render } from "../render/index.js";
import { describe, expect, expectTypeOf, test, vi } from "vitest";

const deferred = () => {
	let resolve!: (value: string) => void;

	return { promise: new Promise<string>((r) => (resolve = r)), resolve };
};

test("raw is for the page, for agents, or for both", async () => {
	const both = (chunk: Render.Chunk) =>
		Promise.all([
			Render.markup(jsx("p", { children: ["a", chunk, "b"] })).string(),
			Render.markdown(jsx("p", { children: ["a", chunk, "b"] })).string(),
		]);

	// markup alone is what agents get too, since Markdown can hold it
	expect(await both(Render.raw({ html: "<b>x</b>" }))).toEqual([
		"<p>a<b>x</b>b</p>",
		"a<b>x</b>b\n",
	]);
	expect(
		await both(Render.raw({ html: "<b>x</b>", markdown: "**x**" })),
	).toEqual(["<p>a<b>x</b>b</p>", "a**x**b\n"]);
	expect(await both(Render.raw({ markdown: " · " }))).toEqual([
		"<p>ab</p>",
		"a · b\n",
	]);
	expect(await both(Render.raw({ html: "<i>!</i>", markdown: "" }))).toEqual([
		"<p>a<i>!</i>b</p>",
		"ab\n",
	]);
	// one or the other, at least
	// @ts-expect-error neither
	void (() => Render.raw({}));
});

test("escape content", () => {
	const escaped = Render.escape(`&<script>console.log("hello")</script>`);

	expect(escaped.includes("&amp")).toBe(true);
	expect(escaped.includes("<")).toBe(false);
});

test("a script takes a media type for a block of data", async () => {
	const props: JSX.IntrinsicElements["script"] = {
		type: "application/ld+json",
		children: Render.raw({ html: '{"@type":"Recipe"}' }),
	};

	expect(await Render.markup(JSX.jsx("script", props)).string()).toBe(
		'<script type="application/ld+json">{"@type":"Recipe"}</script>',
	);
});

test("escape attribute", () => {
	const escaped = Render.escape(`&<script>console.log("hello")</script>`, true);

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
		yield Render.raw({ html: "<b>trusted</b>" });
		yield "<&";
	}
	async function* async() {
		yield Render.raw({ html: "<b>trusted</b>" });
		yield "<&";
	}
	for (const element of [sync(), async()]) {
		expect((await Array.fromAsync(Render.markup(element))).join("")).toBe(
			"<b>trusted</b>&lt;&amp;",
		);
	}
});

test("a render of markup yields strings", async () => {
	const chunks = await Array.fromAsync(
		Render.markup(jsx("p", { children: "<b>" })),
	);

	expectTypeOf(chunks).toEqualTypeOf<string[]>();
	expect(chunks).toStrictEqual(["<p>", "&lt;b>", "</p>"]);
});

test("a render of markup as a child renders its element in place", async () => {
	const child = Render.markup(jsx("b", { children: "x & y" }));

	expect(await Render.markup(jsx("div", { children: child })).string()).toBe(
		"<div><b>x &amp; y</b></div>",
	);
});

test("parallel children render in source order", async () => {
	const first = deferred();
	const second = deferred();
	const started: number[] = [];
	const render = Render.markup([
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
			Render.markup([
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
	const star = Render.raw({ html: "★" });
	const later = new Promise((resolve) => setTimeout(() => resolve("a"), 5));

	// the second child renders while the first waits, so its chunks are queued
	expect(await Render.markup([later, [star, "b"]]).string()).toBe("a★b");
	expect(await Render.markup([star, star]).string()).toBe("★★");
});

const { jsx } = JSX;

/**
 * @param stream Stream of markup
 * @returns Each chunk of the stream as text
 */
const chunks = async (stream: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder();
	const text: string[] = [];
	for await (const chunk of stream) text.push(decoder.decode(chunk));
	return text;
};

describe("elements", () => {
	test("an element is the generator of its chunks", async () => {
		const element = jsx("p", { class: "a", children: ["x", jsx("br", {})] });

		expect(Symbol.asyncIterator in element).toBe(true);
		expect((await element.next()).value?.toString()).toBe('<p class="a">');
		expect((await Array.fromAsync(element)).map(String)).toStrictEqual([
			"x",
			"<br>",
			"</p>",
		]);
		expect((await element.next()).done).toBe(true);
	});

	test("an element renders once, like the generator it is", async () => {
		const element = jsx("p", { children: "x" });

		function* twice() {
			yield element;
			yield element;
		}

		expect(await Render.markup(twice()).string()).toBe("<p>x</p>");
		expect(await Render.markup(element).string()).toBe("");

		const returned = jsx("p", { children: "x" });
		await returned.return();
		expect(await Render.markup(returned).string()).toBe("");
	});

	test("a component is called when it is rendered, not when it is created", async () => {
		let calls = 0;
		const element = jsx(() => {
			calls++;
			return "x";
		}, {});

		expect(calls).toBe(0);
		expect(await Render.markup(element).string()).toBe("x");
		expect(calls).toBe(1);
	});

	test("an element is markup in content that is not, and escapes its own text", async () => {
		expect(
			await Render.markup(["<b>", jsx("p", { children: "<i>" })], {
				raw: true,
			}).string(),
		).toBe("<b><p>&lt;i></p>");
	});

	test("a void element with children is written with its end tag", async () => {
		expect(await Render.markup(jsx("link", {})).string()).toBe("<link>");
		expect(await Render.markup(jsx("link", { children: "x" })).string()).toBe(
			"<link>x</link>",
		);
	});

	test("only the element itself is called or awaited, not what it resolves to", async () => {
		const inner = () => "x";

		expect(await Render.markup(() => inner).string()).toBe(String(inner));
		expect(await Render.markup(Promise.resolve(inner)).string()).toBe(
			String(inner),
		);
		expect(await Render.markup(() => Promise.resolve("x")).string()).toBe("x");
	});

	test("renders elements nested far deeper than the call stack", async () => {
		let element: JSX.Element = "x";
		for (let i = 0; i < 20_000; i++) element = jsx("b", { children: element });

		const markup = await Render.markup(element).string();

		expect(markup.length).toBe(20_000 * 7 + 1);
		expect(markup.startsWith("<b><b>")).toBe(true);
		expect(markup.endsWith("</b></b>")).toBe(true);
	});
});

describe("order and laziness", () => {
	test("a generator is read no faster than its chunks are", async () => {
		let read = 0;

		function* rows() {
			for (;;) yield jsx("li", { children: read++ });
		}

		const render = Render.markup(jsx("ul", { children: rows() }))[
			Symbol.asyncIterator
		]();

		// <ul>, then the three chunks of each of two rows
		for (let i = 0; i < 7; i++) await render.next();

		expect(read).toBe(2);
		await render.return();
	});

	test("a generator after the current child is read as the current one is, not ahead of it", async () => {
		let read = 0;

		function* rows() {
			for (;;) yield String(read++);
		}

		const render = Render.markup([
			jsx("header", { children: ["a", "b", "c", "d", "e", "f"] }),
			rows(),
		])[Symbol.asyncIterator]();

		for (let i = 0; i < 4; i++) await render.next();

		expect(read).toBeGreaterThan(0);
		expect(read).toBeLessThan(10);
		await render.return();
	});

	test("what a later child waits for starts while an earlier one is waited for", async () => {
		const first = deferred();
		let started = false;

		const pending = Render.markup([
			first.promise,
			jsx("section", {
				children: jsx("div", {
					children: async () => {
						started = true;
						return "second";
					},
				}),
			}),
		]).string();

		await vi.waitFor(() => expect(started).toBe(true));
		first.resolve("first");

		expect(await pending).toBe("first<section><div>second</div></section>");
	});

	test("a step goes on through each wait to its chunk without being read", async () => {
		const first = deferred();
		const reached: number[] = [];

		const Third = () => {
			reached.push(3);
			return "second";
		};
		const Second = async () => {
			reached.push(2);
			await new Promise((resolve) => setTimeout(resolve, 1));
			return jsx(Third, {});
		};
		const First = async () => {
			reached.push(1);
			await Promise.resolve();
			return jsx(Second, {});
		};

		const render = Render.markup([first.promise, jsx(First, {})])[
			Symbol.asyncIterator
		]();
		const pending = render.next();

		await vi.waitFor(() => expect(reached).toStrictEqual([1, 2, 3]));
		first.resolve("first");

		expect(String((await pending).value)).toBe("first");
		expect(String((await render.next()).value)).toBe("second");
	});

	test("children nested in arrays render in source order", async () => {
		const slow = (text: string, ms: number) =>
			new Promise<string>((resolve) => setTimeout(() => resolve(text), ms));

		expect(
			await Render.markup([
				[
					slow("a", 6),
					"b",
					[slow("c", 1), jsx("i", { children: slow("d", 3) })],
				],
				jsx("p", { children: ["e", slow("f", 2), ["g", slow("h", 4)]] }),
				"i",
			]).string(),
		).toBe("abc<i>d</i><p>efgh</p>i");
	});

	test("many children that each wait take about as long as one of them", async () => {
		const count = 20_000;
		const wait = () =>
			new Promise<string>((resolve) => setTimeout(() => resolve("x"), 5));
		const started = performance.now();
		const markup = await Render.markup(
			Array.from({ length: count }, () => jsx("li", { children: wait })),
		).string();

		// looking at every child as each one resolves takes seconds
		expect(performance.now() - started).toBeLessThan(1000);
		expect(markup.length).toBe(count * "<li>x</li>".length);
	});
});

describe("failing and stopping", () => {
	test("an error is thrown after the chunks before it", async () => {
		const render = Render.markup(
			jsx("p", {
				children: [
					"before",
					() => {
						throw new Error("failed");
					},
				],
			}),
		)[Symbol.asyncIterator]();

		expect(String((await render.next()).value)).toBe("<p>");
		await expect(Array.fromAsync(render)).rejects.toThrow("failed");
	});

	test("a failure closes generators at any depth, whether read or waiting", async () => {
		const closed: string[] = [];

		function* sync() {
			try {
				yield "a";
				yield "b";
			} finally {
				closed.push("sync");
			}
		}
		async function* waiting() {
			try {
				yield "c";
				await new Promise((resolve) => setTimeout(resolve, 5));
				yield "d";
			} finally {
				closed.push("waiting");
			}
		}

		await expect(
			Render.markup([
				jsx("div", { children: [sync(), jsx("p", { children: waiting() })] }),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("failed")), 1),
				),
			]).string(),
		).rejects.toThrow("failed");
		expect(closed.sort()).toStrictEqual(["sync", "waiting"]);
	});

	test("a render that is not read to its end closes its generators", async () => {
		let closed = 0;

		function* rows() {
			try {
				for (;;) yield "row";
			} finally {
				closed++;
			}
		}

		const render = Render.markup(jsx("ul", { children: [rows(), rows()] }))[
			Symbol.asyncIterator
		]();

		for (let i = 0; i < 3; i++) await render.next();
		await render.return();

		expect(closed).toBe(2);
	});

	test("a cancelled stream closes a generator it is waiting for", async () => {
		let closed = false;

		async function* events() {
			try {
				for (;;) {
					yield "event";
					await new Promise((resolve) => setTimeout(resolve, 1));
				}
			} finally {
				closed = true;
			}
		}

		const reader = Render.markup(events()).stream().getReader();
		await reader.read();
		await reader.cancel();

		expect(closed).toBe(true);
	});

	test("a promise reached by a step that was waiting is not left to reject unhandled", async () => {
		let yielded = false;

		async function* later() {
			await new Promise((resolve) => setTimeout(resolve, 2));
			yielded = true;
			// as a route that starts a query for each element it yields
			yield Promise.reject(new Error("unhandled"));
		}

		await expect(
			Render.markup([
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("failed")), 1),
				),
				later(),
			]).string(),
		).rejects.toThrow("failed");
		expect(yielded).toBe(true);

		// vitest fails the run for a rejection nothing handles
		await new Promise((resolve) => setTimeout(resolve, 5));
	});
});

describe("stream", () => {
	test("sends what renders without waiting together, and what is waited for when it resolves", async () => {
		const later = deferred();
		const reader = Render.markup(
			jsx("ul", {
				children: [
					jsx("li", { children: "a" }),
					jsx("li", { children: later.promise }),
				],
			}),
		)
			.stream()
			.getReader();
		const decoder = new TextDecoder();

		// nothing after the promise is held back for it
		expect(decoder.decode((await reader.read()).value)).toBe(
			"<ul><li>a</li><li>",
		);

		later.resolve("b");

		expect(decoder.decode((await reader.read()).value)).toBe("b</li></ul>");
		expect((await reader.read()).done).toBe(true);
	});

	test("renders no further ahead than the stream's buffer", async () => {
		let read = 0;

		function* rows() {
			for (;;) yield jsx("li", { children: `row ${read++}` });
		}

		const reader = Render.markup(jsx("ul", { children: rows() }))
			.stream()
			.getReader();
		const first = (await reader.read()).value!;

		// about the high water mark of 2kb, not all that the generator has
		expect(first.byteLength).toBeGreaterThanOrEqual(2048);
		expect(first.byteLength).toBeLessThan(2048 + 64);
		expect(read).toBeLessThan(400);
		await reader.cancel();
	});

	test("an empty chunk is not sent, a stream of bytes rejects one", async () => {
		expect(
			await chunks(
				Render.markup([
					"a",
					Render.raw({ html: "" }),
					"b",
					Render.raw({ html: "" }),
				]).stream(),
			),
		).toStrictEqual(["ab"]);
		expect(
			await chunks(Render.markup(Render.raw({ html: "" })).stream()),
		).toStrictEqual([]);
	});

	test("an error ends the stream after the markup before it", async () => {
		const reader = Render.markup([
			"before",
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("failed")), 1),
			),
		])
			.stream()
			.getReader();

		expect(new TextDecoder().decode((await reader.read()).value)).toBe(
			"before",
		);
		await expect(reader.read()).rejects.toThrow("failed");
	});
});
