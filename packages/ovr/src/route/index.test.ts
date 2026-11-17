import { App } from "../app/index.js";
import type { Context } from "../context/index.js";
import { Field, Form, address, forms } from "../form/index.js";
import { jsx } from "../jsx/index.js";
import type { JSX } from "../jsx/index.js";
import { Mcp } from "../mcp/index.js";
import { Render } from "../render/index.js";
import { Schema } from "../schema/index.js";
import { Route } from "./index.js";
import { describe, expect, expectTypeOf, test } from "vitest";

/**
 * @param url The page's address
 * @param state What a refused submission kept, which a request has in a
 * cookie, named in the address
 * @param sent Path of the form it was sent to, the page's own by default
 * @returns The context of a request for the page, as far as a form reads it
 */
const page = (url: string, state?: string, sent?: string) => {
	const at = new URL(url, "http://localhost:5173");
	if (state !== undefined) at.searchParams.set("_form", "1a2b3c4d");

	return {
		url: at,
		cookie: {
			get: (name: string) =>
				name === "_form" && state !== undefined
					? `1a2b3c4d.${address.write(sent ?? at.pathname)}.${state}`
					: undefined,
		},
		memo: (fn: unknown) => fn,
	} as unknown as Context;
};

/**
 * @param element Element to render
 * @param c Context of the request it is rendered for
 * @returns Its markup
 */
const shown = (element: JSX.Element, c: Context) =>
	new Render({ markup: element }, { context: c }).string();

describe("Route schema helpers", () => {
	test("rejecting an oversized field cancels the remaining upload", async () => {
		let canceled = false;
		let reads = 0;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							reads++ === 0
								? '--audit\r\nContent-Disposition: form-data; name="name"\r\n\r\n'
								: "x".repeat(256),
						),
					);
				},
				cancel() {
					canceled = true;
				},
			},
			{ highWaterMark: 0 },
		);
		const route = Route.post("/upload")
			.fields({ name: Field.text() })
			.use(async (c) => {
				await c.data({ payload: 128 });
				c.text("accepted");
			});
		const res = await new App()
			.use(route)
			.fetch("https://example.com/upload", {
				method: "POST",
				headers: { "content-type": "multipart/form-data; boundary=audit" },
				body,
				...{ duplex: "half" },
			});
		expect(res.status).toBe(413);
		expect(await res.text()).toBe("Payload Too Large");
		expect(canceled).toBe(true);
	});

	test("Route.get parses query params with shape schema via c.data()", async () => {
		const search = Route.get("/search")
			.fields({
				query: Field.text(),
				tags: Field.select(["a", "b", "c"]).multiple(),
				active: Field.checkbox(),
			})
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.json({ issues: result.issues.length }, 400);
					return;
				}

				c.json(result.data);
			});
		const app = new App().use(search);

		const res = await app.fetch(
			"http://localhost:5173/search?query=hello&tags=a&tags=c&active=on",
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			query: "hello",
			tags: ["a", "c"],
			active: true,
		});
	});

	test("Route.get parses query params with a shared shape", async () => {
		const shape = {
			name: Field.text(),
			role: Field.radio(["reader", "admin"]),
		};
		const user = Route.get("/user")
			.fields(shape)
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.text("Invalid", 400);
					return;
				}

				c.json(result.data);
			});
		const app = new App().use(user);

		const res = await app.fetch(
			"http://localhost:5173/user?name=ross&role=admin",
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ name: "ross", role: "admin" });
	});

	test("a GET form shows what is wrong with its URL, once it was sent", async () => {
		const search = Route.get("/search")
			.fields({ role: Field.radio(["reader", "admin"]) })
			.use(async (c) => {
				const result = await c.data();
				return [jsx(search.Form, {}), result.issues ? "refused" : "found"];
			});
		const app = new App().use(search);
		const get = async (path: string) =>
			(await app.fetch(new Request(`http://localhost:5173${path}`))).text();

		// its submission is the URL, so the page that reads it shows the issue
		const refused = await get("/search?role=owner");
		expect(refused).toContain("Select an option");
		expect(refused).toContain("refused");
		expect(refused).toContain('action="/search"');

		// opened without any of its fields, it was not sent
		const opened = await get("/search?page=2");
		expect(opened).not.toContain("Select an option");
		expect(opened).not.toContain("aria-invalid");

		expect(await get("/search?role=admin")).toContain("found");
	});

	test("schema-enabled GET handles HEAD requests without form parsing", async () => {
		const search = Route.get("/search")
			.fields({ query: Field.text() })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.text("Invalid", 400);
					return;
				}

				c.text(result.data.query);
			});
		const app = new App().use(search);

		const res = await app.fetch(
			new Request("http://localhost:5173/search?query=hello", {
				method: "HEAD",
			}),
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("location")).toBeNull();
	});

	test("schema-enabled Route.get exposes route and schema helpers", () => {
		const form = Route.get("/profile")
			.fields({ name: Field.text() })
			.use((c) => c.text("ok"));

		expect(typeof form.Anchor).toBe("function");
		expect(typeof form.Form).toBe("function");
		expect(typeof form.Button).toBe("function");
	});

	test("a route's Form defaults to its fields and a submit button, with a request or without", async () => {
		const profile = Route.get("/profile")
			.fields({ name: Field.text() })
			.use((c) => c.text("ok"));

		const html = await new Render({ markup: jsx(profile.Form, {}) }).string();

		// the same as the form for a request that holds nothing for it
		expect(await shown(jsx(profile.Form, {}), page("/profile"))).toBe(html);

		expect(html.includes('action="/profile"')).toBe(true);
		expect(html.includes('method="GET"')).toBe(true);
		expect(html.includes('name="name"')).toBe(true);
		expect(html.includes(">Submit</button>")).toBe(true);
	});

	test("a Route.post Form rendered for a page returns a refused submission to it", async () => {
		const submit = Route.post("/submit")
			.fields({ name: Field.text() })
			.use((c) => c.text("ok"));
		const html = await shown(
			jsx(submit.Form, {}),
			page("/signup?tab=profile&_form=stale&_return=%2Fold#details"),
		);

		expect(
			html.includes(
				'action="/submit?_return=%2Fsignup%3Ftab%3Dprofile%23details"',
			),
		).toBe(true);
		expect(html.includes("_form=stale")).toBe(false);
		expect(html.includes("_return=%252Fold")).toBe(false);
	});

	test("invalid POST schema parse prefers same-origin _return query", async () => {
		const submit = Route.post("/submit")
			.fields({ role: Field.radio(["reader", "admin"]) })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			});
		const app = new App().use(submit);
		const data = new FormData();

		data.set("role", "owner");

		const res = await app.fetch(
			new Request(
				"http://localhost:5173/submit?_return=%2Fsource%3Ffrom%3Dreturn",
				{
					method: "POST",
					body: data,
					headers: { origin: "http://localhost:5173" },
				},
			),
		);

		expect(res.status).toBe(303);

		const location = res.headers.get("location");
		if (!location) throw new Error("Expected redirect location");

		const url = new URL(location);

		expect(url.pathname).toBe("/source");
		expect(url.searchParams.get("from")).toBe("return");
		expect(url.searchParams.get("_form")).toBeTruthy();
	});

	test("invalid POST schema parse falls back to request URL when _return is missing", async () => {
		const submit = Route.post("/submit")
			.fields({ role: Field.radio(["reader", "admin"]) })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			});
		const app = new App().use(submit);
		const data = new FormData();

		data.set("role", "owner");

		const res = await app.fetch(
			new Request("http://localhost:5173/submit", {
				method: "POST",
				body: data,
				headers: {
					origin: "http://localhost:5173",
					referer: "http://localhost:5173/source?from=referer",
				},
			}),
		);

		expect(res.status).toBe(303);

		const location = res.headers.get("location");
		if (!location) throw new Error("Expected redirect location");

		const url = new URL(location);

		expect(url.pathname).toBe("/submit");
		expect(url.searchParams.get("from")).toBeNull();
		expect(url.searchParams.get("_return")).toBeNull();
		expect(url.searchParams.get("role")).toBeNull();
		expect(url.searchParams.get("_form")).toBeTruthy();
	});

	test("invalid POST schema parse ignores cross-origin _return query", async () => {
		const submit = Route.post("/submit")
			.fields({ role: Field.radio(["reader", "admin"]) })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			});
		const app = new App().use(submit);
		const data = new FormData();

		data.set("role", "owner");

		const res = await app.fetch(
			new Request(
				"http://localhost:5173/submit?_return=https%3A%2F%2Fevil.example%2Fsource%3Ffrom%3Dreturn",
				{
					method: "POST",
					body: data,
					headers: {
						origin: "http://localhost:5173",
						referer: "http://localhost:5173/source?from=referer",
					},
				},
			),
		);

		expect(res.status).toBe(303);

		const location = res.headers.get("location");
		if (!location) throw new Error("Expected redirect location");

		const url = new URL(location);

		expect(url.pathname).toBe("/submit");
		expect(url.searchParams.get("from")).toBeNull();
		expect(url.searchParams.get("_return")).toBeNull();
		expect(url.searchParams.get("_form")).toBeTruthy();
	});

	test("invalid multipart POST with streamed file field returns redirect", async () => {
		const submit = Route.post("/upload")
			.fields({ name: Field.text().min(2), license: Field.file().stream() })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				if (result.stream) {
					for await (const part of result.stream) {
						await part.bytes();
					}
				}

				c.text("ok");
			});
		const app = new App().use(submit);
		const data = new FormData();

		data.set("name", "x");
		data.set(
			"license",
			new File(["abc"], "license.txt", { type: "text/plain" }),
		);

		const res = (await Promise.race([
			app.fetch(
				new Request("http://localhost:5173/upload", {
					method: "POST",
					body: data,
					headers: { origin: "http://localhost:5173" },
				}),
			),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error("Timed out waiting for multipart response")),
					1000,
				);
			}),
		])) as Response;

		expect(res.status).toBe(303);

		const location = res.headers.get("location");
		if (!location) throw new Error("Expected redirect location");

		const url = new URL(location);

		expect(url.pathname).toBe("/upload");
		expect(url.searchParams.get("_form")).toBeTruthy();
	});

	test("c.data passes multipart options to parser", async () => {
		const submit = Route.post("/limit")
			.fields({ a: Field.text(), b: Field.text() })
			.use(async (c) => {
				// a body over a limit throws, for the handler or the app to answer
				const result = await c.data({ parts: 1 });

				if (result.issues) {
					c.text("invalid", 400);
					return;
				}

				c.json(result.data);
			});
		const app = new App().use(submit);
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "y");

		const res = await app.fetch(
			new Request("http://localhost:5173/limit", {
				method: "POST",
				body: data,
				headers: { origin: "http://localhost:5173" },
			}),
		);
		expect(res.status).toBe(413);
		expect(await res.text()).toBe("Too Many Parts");
	});

	test.each([
		["text/plain", "Unsupported Media Type"],
		["multipart/form-data", "Boundary Not Found"],
		["multipart/form-data; boundary=a@b", "Invalid Boundary"],
	])(
		"c.data throws a TypeError for a %s body, which the handler can answer",
		async (type, message) => {
			const submit = Route.post("/form")
				.fields({ a: Field.text() })
				.use(async (c) => {
					try {
						await c.data();
						c.text("accepted");
					} catch (error) {
						if (!(error instanceof TypeError)) throw error;
						c.text(error.message, 400);
					}
				});
			const res = await new App()
				.use(submit)
				.fetch(
					new Request("http://localhost:5173/form", {
						method: "POST",
						body: "a=x",
						headers: { origin: "http://localhost:5173", "content-type": type },
					}),
				);

			expect(res.status).toBe(400);
			expect(await res.text()).toBe(message);
		},
	);

	test("params and fields after use are a type error, since middleware is typed by them", () => {
		const route = Route.get("/items/:id").use((c) => c.text(c.params.id));
		void (() => {
			// @ts-expect-error - call .params() before .use()
			route.params({ id: Schema.string() });
			// @ts-expect-error - call .fields() before .use()
			route.fields({ q: Field.search() });
		});

		// more middleware, and a description, may still follow
		const more = route.use((_, next) => next()).describe("An item");
		expect(more.description).toBe("An item");

		// a route after use is still a route the app mounts
		const app = new App().use(more);
		expect(app).toBeInstanceOf(App);
	});

	test("c.data returns null on routes without a schema", async () => {
		const noSchema = Route.get("/no-schema").use(async (c) => {
			const result = await c.data();
			c.text(result === null ? "ok" : "bad");
		});
		const app = new App().use(noSchema);
		const res = await app.fetch("http://localhost:5173/no-schema");

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	test("c.data auto-applies schema parts limit", async () => {
		const submit = Route.post("/auto-limit")
			.fields({ a: Field.text(), b: Field.text() })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.text("invalid", 400);
					return;
				}

				c.text("ok");
			});
		const app = new App().use(submit);
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "y");
		data.set("c", "z");

		const res = await app.fetch(
			new Request("http://localhost:5173/auto-limit", {
				method: "POST",
				body: data,
				headers: { origin: "http://localhost:5173" },
			}),
		);
		expect(res.status).toBe(413);
		expect(await res.text()).toBe("Too Many Parts");
	});

	test("schema auto parts overrides app multipart parts option", async () => {
		const submit = Route.post("/app-limit")
			.fields({ a: Field.text(), b: Field.text() })
			.use(async (c) => {
				try {
					const result = await c.data();

					if (result.issues) {
						c.text("invalid", 400);
						return;
					}

					c.text("ok");
				} catch (error) {
					c.text(error instanceof Error ? error.message : String(error), 413);
				}
			});
		const app = new App({ multipart: { parts: 1 } }).use(submit);
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "y");

		const res = await app.fetch(
			new Request("http://localhost:5173/app-limit", {
				method: "POST",
				body: data,
				headers: { origin: "http://localhost:5173" },
			}),
		);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	test("c.data parts option overrides app multipart parts option", async () => {
		const submit = Route.post("/call-limit")
			.fields({ a: Field.text(), b: Field.text() })
			.use(async (c) => {
				try {
					const result = await c.data({ parts: 2 });

					if (result.issues) {
						c.text("invalid", 400);
						return;
					}

					c.text("ok");
				} catch (error) {
					c.text(error instanceof Error ? error.message : String(error), 413);
				}
			});
		const app = new App({ multipart: { parts: 1 } }).use(submit);
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "y");

		const res = await app.fetch(
			new Request("http://localhost:5173/call-limit", {
				method: "POST",
				body: data,
				headers: { origin: "http://localhost:5173" },
			}),
		);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});
});

describe("editing records", () => {
	const fields = {
		title: Field.text(),
		body: Field.textarea(),
		done: Field.checkbox(),
		file: Field.file(),
	};

	test("Form renders initial values, and a failed submission takes precedence", async () => {
		const update = Route.post("/posts/:id")
			.fields(fields)
			.use((c) => c.text("ok"));
		const post = {
			id: "1",
			title: "Draft",
			body: "Text",
			done: true,
			created: new Date(),
			file: "not a file",
			note: null,
		};
		const html = await shown(
			jsx(update.Form, { params: { id: "1" }, values: post }),
			page("/posts/1"),
		);

		expect(html).toContain('value="Draft"');
		expect(html).toContain(">Text</textarea>");
		expect(html).toContain("checked");
		expect(html).not.toContain("values=");
		expect(html).not.toContain("not a file");

		// what a refused submission sent is shown over the record
		const refused = Route.post("/posts/:id")
			.fields({ ...fields, title: fields.title.min(10) })
			.use((c) => c.text("ok"));
		const body = new FormData();
		body.set("title", "Typed");
		body.set("body", "Other");
		const result = await forms.get(refused)!.parse(body);
		if (!result.issues) throw new Error("Expected issues");
		const restored = await shown(
			jsx(refused.Form, { params: { id: "1" }, values: post }),
			page("/posts/1", result.state),
		);

		expect(restored).toContain('value="Typed"');
		expect(restored).toContain(">Other</textarea>");
		// and nothing that was sent is in the address
		expect(restored).not.toContain("Typed%");
	});

	test("a link's search params fill a GET form, and no other", async () => {
		const shape = { id: Field.hidden(), title: Field.text() };
		const state = page("/posts/1/edit?id=2&title=Typed");
		const values = { id: "1", title: "Draft" };
		const update = Route.post("/posts/:id")
			.fields(shape)
			.use((c) => c.text("ok"));
		const search = Route.get("/posts")
			.fields(shape)
			.use((c) => c.text("ok"));
		const form = new Form(shape);

		for (const html of [
			await shown(
				jsx(update.Form, { params: { id: "1" }, values: values }),
				state,
			),
			await shown(jsx(form.bind(values).Fields, {}), state),
		]) {
			expect(html).toContain('name="id" value="1"');
			expect(html).toContain('value="Draft"');
		}

		const filled = await shown(jsx(search.Form, { values: values }), state);

		expect(filled).toContain('name="id" value="2"');
		expect(filled).toContain('value="Typed"');
	});

	test("Form labels its submit button", async () => {
		const update = Route.post("/posts/:id")
			.fields(fields)
			.use((c) => c.text("ok"));
		const html = await new Render({
			markup: [
				jsx(update.Form, { params: { id: "1" }, submit: "Save changes" }),
				jsx(update.Form, { params: { id: "1" } }),
			],
		}).string();

		expect(html).toContain("<button>Save changes</button>");
		expect(html).toContain("<button>Submit</button>");
		expect(html).not.toContain("submit=");
	});

	test("a route's own Form shows what a request holds for it", async () => {
		const signup = Route.post("/signup")
			.fields({ email: Field.email() })
			.use((c) => c.text("ok"));
		const body = new FormData();
		body.set("email", "not an email");
		const refused = await forms.get(signup)!.parse(body);
		if (!refused.issues) throw new Error("Expected issues");
		const request = page("/signup", refused.state);

		const plain = await new Render({ markup: jsx(signup.Form, {}) }).string();
		expect(plain).toContain('name="email"');
		expect(plain).toContain('action="/signup"');
		expect(plain).not.toContain("not an email");
		expect(plain).not.toContain("aria-invalid");

		const bound = await shown(jsx(signup.Form, {}), request);
		expect(bound).toContain('value="not an email"');
		expect(bound).toContain('aria-invalid="true"');
		// it posts to the page it is on, which a refusal returns to already
		expect(bound).toContain('action="/signup"');
	});

	test("a Form without fields is still a button to submit, unless given children", async () => {
		const remove = Route.post("/posts/:id/delete").use((c) => c.text("ok"));
		expect(
			await new Render({
				markup: jsx(remove.Form, { params: { id: "1" }, submit: "Delete" }),
			}).string(),
		).toBe(
			'<form action="/posts/1/delete" method="POST" enctype="multipart/form-data"><button>Delete</button></form>',
		);
		expect(
			await new Render({
				markup: jsx(remove.Form, {
					params: { id: "1" },
					children: jsx("button", { children: "Remove" }),
				}),
			}).string(),
		).toBe(
			'<form action="/posts/1/delete" method="POST" enctype="multipart/form-data"><button>Remove</button></form>',
		);
	});

	test("a bound form's Field and component have the initial values", async () => {
		const form = new Form(fields).bind({ title: "One", body: "Two" });
		const html = await new Render({
			markup: [
				jsx(form.Field, { name: "title" }),
				form.component({ name: "body" }).Control(),
			],
		}).string();

		expect(html).toContain('value="One"');
		expect(html).toContain(">Two</textarea>");
	});

	test("initial record values are not limited by what a refused submission can keep", async () => {
		const update = Route.post("/posts/:id")
			.fields({ body: Field.textarea() })
			.use((c) => c.text("ok"));
		const body = "Article text. ".repeat(100);
		const html = await shown(
			jsx(update.Form, { params: { id: "1" }, values: { body } }),
			page("/posts/1"),
		);

		expect(html).toContain(`>${body}</textarea>`);
	});

	test.each(["parse", "database"])(
		"cleared fields override initial values after a %s error",
		async (failure) => {
			const form = new Form({
				title: Field.text().optional(),
				tags: Field.select(["a", "b"]).multiple().optional(),
				email: Field.email(),
			});
			const input = new FormData();
			input.set("title", "");
			input.set("email", failure === "parse" ? "invalid" : "taken@example.com");
			const parsed = await form.parse(input);
			const result = parsed.issues
				? parsed
				: await parsed.invalid({ email: "Already registered" });
			const html = await shown(
				jsx(
					form.bind(
						{ title: "Old title", tags: ["a"] },
						await form.read(page("/"), () => ({ state: result.state }), "/"),
					).Fields,
					{},
				),
				page("/"),
			);

			expect(html).not.toContain('value="Old title"');
			expect(html).not.toContain("selected");
		},
	);
});

describe("a refused submission", () => {
	const fields = { name: Field.text().min(3) };
	const rename = Route.post("/items/:id/rename")
		.fields(fields)
		.use(async (c) => {
			const result = await c.data();
			return result.issues ? c.redirect(result.url, 303) : c.text("ok");
		});
	// another route with the same fields
	const note = Route.post("/notes/:id/rename")
		.fields(fields)
		.use((c) => c.text("ok"));
	const list = Route.get("/items").use(() => {
		return [
			// the form as it is, one laid out by hand, and another route's
			jsx(rename.Form, { params: { id: "1" } }),
			jsx(rename.Form, {
				params: { id: "2" },
				values: { name: "Two" },
				children: (form) => jsx(form.Field, { name: "name" }),
			}),
			jsx(rename.Form, { params: { id: "3" }, values: { name: "Three" } }),
			jsx(note.Form, { params: { id: "2" } }),
		];
	});
	const app = new App().use(rename, note, list);

	/**
	 * @param id Item to rename, with a name that is too short
	 * @returns Each form's action, with the value and validity of its field
	 */
	const refuse = async (id: string) => {
		const body = new FormData();
		body.set("name", "x");
		const refused = await app.fetch(
			new Request(`http://localhost/items/${id}/rename?_return=%2Fitems`, {
				method: "POST",
				body,
				headers: { origin: "http://localhost" },
			}),
		);
		const html = await (
			await app.fetch(
				new URL(refused.headers.get("location")!, "http://localhost"),
				{
					headers: {
						cookie: refused.headers.getSetCookie()[0]!.split(";", 1)[0]!,
					},
				},
			)
		).text();

		return html
			.split("<form ")
			.slice(1)
			.map((form) => [
				/action="([^"?]+)/.exec(form)![1],
				/ value="([^"]*)"/.exec(form)?.[1] ?? "",
				form.includes('aria-invalid="true"'),
			]);
	};

	test("is shown by the form it was sent to, and no other with its fields", async () => {
		expect(await refuse("2")).toEqual([
			["/items/1/rename", "", false],
			["/items/2/rename", "x", true],
			["/items/3/rename", "Three", false],
			["/notes/2/rename", "", false],
		]);
		expect(await refuse("1")).toEqual([
			["/items/1/rename", "x", true],
			["/items/2/rename", "Two", false],
			["/items/3/rename", "Three", false],
			["/notes/2/rename", "", false],
		]);
	});

	test("is shown by the form with its hidden values, of forms at one address", async () => {
		// a button in every row, which sends the row's ID to one address
		const add = Route.post("/week/:start/add")
			.fields({ recipe: Field.hidden(), servings: Field.number().min(1) })
			.use(async (c) => {
				const result = await c.data();
				return result.issues ? c.redirect(result.url, 303) : c.text("ok");
			});
		const week = Route.get("/week").use(() =>
			["a", "b", "c"].map((recipe) =>
				jsx(add.Form, { params: { start: "monday" }, values: { recipe } }),
			),
		);
		const app = new App().use(add, week);
		const body = new FormData();
		body.set("recipe", "b");
		body.set("servings", "0");
		const refused = await app.fetch(
			new Request("http://localhost/week/monday/add?_return=%2Fweek", {
				method: "POST",
				body,
				headers: { origin: "http://localhost" },
			}),
		);
		const html = await (
			await app.fetch(
				new URL(refused.headers.get("location")!, "http://localhost"),
				{
					headers: {
						cookie: refused.headers.getSetCookie()[0]!.split(";", 1)[0]!,
					},
				},
			)
		).text();

		expect(
			html
				.split("<form ")
				.slice(1)
				.map((form) => [
					/name="recipe" value="([^"]*)"/.exec(form)?.[1],
					form.includes('aria-invalid="true"'),
				]),
		).toEqual([
			["a", false],
			["b", true],
			["c", false],
		]);
	});

	test("is read outside its form, by the page around it", async () => {
		const page = Route.get("/fold").use(async (c) =>
			c.json({
				one: (await rename.issues(c, { id: "1" }))?.map((i) => i.message),
				two: (await rename.issues(c, { id: "2" }))?.map((i) => i.message),
			}),
		);
		const app = new App().use(rename, page);
		const body = new FormData();
		body.set("name", "x");
		const refused = await app.fetch(
			new Request("http://localhost/items/2/rename?_return=%2Ffold", {
				method: "POST",
				body,
				headers: { origin: "http://localhost" },
			}),
		);
		const location = new URL(
			refused.headers.get("location")!,
			"http://localhost",
		);
		const cookie = refused.headers.getSetCookie()[0]!.split(";", 1)[0]!;

		expect(
			await (await app.fetch(location, { headers: { cookie } })).json(),
		).toEqual({ two: [expect.stringContaining("3")] });
		// nothing was refused for a page opened without it
		expect(await (await app.fetch("http://localhost/fold")).json()).toEqual({});

		// @ts-expect-error the pattern has a parameter
		void ((c: Context) => rename.issues(c));
	});

	test("of a hidden field shows its issue, and marks no control", async () => {
		const pick = Route.post("/pick")
			.fields({ recipe: Field.hidden().min(3, "Choose a recipe") })
			.use(async (c) => {
				const result = await c.data();
				return result.issues ? c.redirect(result.url, 303) : c.text("ok");
			});
		const app = new App().use(
			pick,
			Route.get("/").use(() => jsx(pick.Form, { values: { recipe: "x" } })),
		);
		const body = new FormData();
		body.set("recipe", "x");
		const refused = await app.fetch(
			new Request("http://localhost/pick?_return=%2F", {
				method: "POST",
				body,
				headers: { origin: "http://localhost" },
			}),
		);
		const html = await (
			await app.fetch(
				new URL(refused.headers.get("location")!, "http://localhost"),
				{
					headers: {
						cookie: refused.headers.getSetCookie()[0]!.split(";", 1)[0]!,
					},
				},
			)
		).text();

		// the message is there for the person, since the control is not
		expect(html).toContain(
			'<p id="recipe-issue" data-issue="0">Choose a recipe</p>',
		);
		expect(html).toContain('<input type="hidden" name="recipe" value="x">');
		expect(html).not.toContain("aria-invalid");
		expect(html).not.toContain("aria-describedby");
		expect(html).not.toContain("autofocus");
	});

	test("a form's values and parts are typed by its route's fields", () => {
		const id = { id: "1" };

		void ((c: Context) => {
			// @ts-expect-error the pattern has a parameter
			rename.Form({}, c);
			// @ts-expect-error not one of the fields
			rename.Form({ params: id, values: { title: "" } }, c);
			// @ts-expect-error a form is a component, rendered for a request
			rename.Form({ params: id });
			rename.Form(
				{
					params: id,
					values: { name: "One" },
					children: (form) => {
						// @ts-expect-error not one of the fields
						form.Field({ name: "title" });

						return jsx(form.Field, { name: "name" });
					},
				},
				c,
			);
		});
	});
});

describe("invalid after parsing", () => {
	test("puts issues on fields and keeps what was sent", async () => {
		const form = Route.get("/signup").use(() => jsx(signup.Form, {}));
		const signup = Route.post("/signup")
			.fields({ email: Field.email(), name: Field.text() })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) return c.redirect(result.url, 303);

				// for example, a unique constraint rejected the insert
				return c.redirect(
					(await result.invalid({ email: "Already registered" })).url,
					303,
				);
			});
		const app = new App().use(form, signup);
		const data = new FormData();

		data.set("email", "taken@example.com");
		data.set("name", "Ross");

		const res = await app.fetch(
			new Request("http://localhost:5173/signup?_return=%2Fsignup", {
				method: "POST",
				body: data,
				headers: { origin: "http://localhost:5173" },
			}),
		);
		const location = new URL(res.headers.get("location")!);

		expect(res.status).toBe(303);
		expect(location.pathname).toBe("/signup");

		// the address names the submission, a cookie for that page holds it
		expect(location.search).toMatch(/^\?_form=[0-9a-f]{8}$/);
		const [cookie] = res.headers.getSetCookie();
		// its ID, the form it was sent to, and what was sent
		expect(cookie).toMatch(
			/^_form=[0-9a-f]{8}\.[\w-]+\.[\w-]+; Path=\/signup; /,
		);

		const html = await (
			await app.fetch(location, {
				headers: { cookie: cookie!.split(";", 1)[0]! },
			})
		).text();

		expect(html).toContain("Already registered");
		expect(html).toContain('value="taken@example.com"');
		expect(html).toContain('aria-invalid="true"');
		expect(html).toContain('value="Ross"');

		// without the cookie, as for anyone else given the address, it is the form
		const other = await (await app.fetch(location)).text();
		expect(other).not.toContain("Already registered");
		expect(other).not.toContain("taken@example.com");
	});
});

describe("chained routes", () => {
	test("forms are WebMCP tools for browser agents", async () => {
		const render = (element: unknown) =>
			new Render({ markup: element as JSX.Element }).string();

		// a form that may change data waits for the user to submit it
		const create = Route.post("/posts")
			.describe("Create a post. It starts as a draft.")
			.fields({
				title: Field.text().label("Title").describe("Shown in the list"),
			});
		const created = await shown(jsx(create.Form, {}), page("/posts"));
		expect(created).toContain(
			'toolname="post_posts" tooltitle="Create a post" tooldescription="Create a post. It starts as a draft."',
		);
		// what the label does not say, for the agent that fills it in
		expect(created).toContain(
			'toolparamdescription="Title: Shown in the list"',
		);
		expect(created).not.toContain("toolautosubmit");

		// a search the agent submits itself
		const search = Route.get("/search")
			.describe("Search posts")
			.fields({ q: Field.search() });
		expect(await shown(jsx(search.Form, {}), page("/search"))).toContain(
			'toolname="get_search" tooltitle="Search posts" tooldescription="Search posts" toolautosubmit',
		);

		// a form per record would repeat the name, and only described routes are tools
		const remove = Route.post("/posts/:id/delete").describe("Delete a post");
		for (const html of [
			await render(jsx(remove.Form, { params: { id: "1" } })),
			await render(jsx(Route.post("/internal").Form, {})),
			await render(jsx(Route.get("/about").Form, {})),
		])
			expect(html).not.toContain("toolname");

		// props override them
		expect(
			await render(
				jsx(remove.Form, {
					params: { id: "1" },
					toolname: "delete_post",
					tooldescription: "Delete this post",
				}),
			),
		).toContain('toolname="delete_post" tooldescription="Delete this post"');
	});

	test("a description names another route's tool, whichever is written first", () => {
		const publish = Route.post("/posts/:id/publish").describe(
			() => `Publish a post. To undo it, call ${unpublish.tool.name()}.`,
		);
		const unpublish = Route.post("/posts/:id/unpublish").describe(
			() =>
				`Stop publishing a post. To publish again, call ${publish.tool.name()}.`,
		);
		const draft = Route.post("/posts/:id/draft");

		new App().use(publish, unpublish);

		expect(publish.tool.name()).toBe("post_posts_id_publish");
		expect(publish.tool.title).toBe("Publish a post");
		expect(publish.tool.description).toBe(
			"Publish a post. To undo it, call post_posts_id_unpublish.",
		);
		expect(unpublish.description).toBe(
			"Stop publishing a post. To publish again, call post_posts_id_publish.",
		);

		// a route with no description is no tool to name
		expect(() => draft.tool.name()).toThrow(
			"POST /posts/:id/draft has no tool to name",
		);
		// which is found as the app starts, as a blank description is
		expect(() =>
			new App().use(
				Route.post("/a").describe(() => `See ${draft.tool.name()}`),
			),
		).toThrow("POST /posts/:id/draft has no tool to name");
		expect(() => new App().use(Route.post("/b").describe(() => " "))).toThrow(
			"The description of POST /b is blank",
		);
	});

	test("describe takes its options on a route that writes", () => {
		Route.post("/posts").describe("Create a post", { destructive: false });
		new Route("POST", "/posts").describe("Create a post", {
			destructive: false,
		});
		// @ts-expect-error a route that reads is never destructive
		Route.get("/posts").describe("List the posts", { destructive: false });
	});

	test("url is typed by the path it builds", () => {
		const page = Route.get("/hello/:name");
		const home = Route.get("/");
		const name: string = "world";

		expectTypeOf(home.url()).toEqualTypeOf<"/">();
		expectTypeOf(
			page.url({ params: { name: "world" } as const }),
		).toEqualTypeOf<"/hello/world">();
		expectTypeOf(
			page.url({ params: { name } }),
		).toEqualTypeOf<`/hello/${string}`>();
		// search and hash make it any string
		expectTypeOf(
			page.url({ params: { name }, search: { q: "1" } }),
		).toEqualTypeOf<string>();
		expectTypeOf(home.url({ hash: "top" })).toEqualTypeOf<string>();

		// a list of exact paths
		const names = [
			{ name: "world" },
			{ name: "ross" },
		] as const satisfies Route.Params<typeof page>[];
		expectTypeOf(names.map((params) => page.url({ params }))).toEqualTypeOf<
			("/hello/world" | "/hello/ross")[]
		>();

		// @ts-expect-error the pattern's parameters are required
		page.url();
		// @ts-expect-error and only those
		page.url({ params: { id: "1" } });
	});

	test("params take whole parameter names, and redirects need their values", () => {
		// @ts-expect-error not a parameter of the pattern
		Route.get("/items/:id").params({ i: Field.text() });

		const item = Route.get("/items/:id");
		const files = Route.get("/files/*");
		const home = Route.get("/");
		Route.get("/go").use((c) => {
			// @ts-expect-error parameters need values, from route.url({ params })
			c.redirect(item, 303);
			// @ts-expect-error a wildcard too
			c.redirect(files);
			c.redirect(home);
			c.redirect(item.url({ params: { id: "1" } }), 303);
		});
	});

	test("a root wildcard cannot turn a form action into another origin", () => {
		const save = Route.post("/*");
		try {
			const action = save.url({ params: { "*": "/outside.example/collect" } });
			expect(new URL(action, "https://app.example").origin).toBe(
				"https://app.example",
			);
		} catch (error) {
			if (!(error instanceof TypeError)) throw error;
		}
	});

	test("a pattern and an MCP endpoint's path are checked as they are written", () => {
		void (() => {
			// @ts-expect-error - a pattern starts with /
			Route.get("posts");
			// @ts-expect-error - without a query
			Route.get("/posts?page=1");
			// @ts-expect-error - another host
			Route.post("//evil.example/x");
			// @ts-expect-error - a fixed path, without parameters
			new Mcp({ path: "/mcp/:id" });
			// @ts-expect-error - a fixed path, without a trailing slash
			new Mcp({ path: "/mcp/" });
		});

		const fromConfig: string = "/anything";
		expect(Route.get(fromConfig).pattern).toBe("/anything");
		expect(Route.get("/files/:id/*").pattern).toBe("/files/:id/*");
		expect(new Mcp({ path: "/agents/mcp" })).toBeInstanceOf(Mcp);
	});

	test("a parameter a schema made a number can be given back as one", async () => {
		const post = Route.get("/posts/:id")
			.params({ id: Schema.number().preprocess(Number).int() })
			.use((c) => {
				expectTypeOf(c.params.id).toEqualTypeOf<number>();
				return post.Anchor({
					params: { id: c.params.id + 1 },
					children: "Next",
				});
			});

		expectTypeOf(
			post.url({ params: { id: 7 } }),
		).toEqualTypeOf<`/posts/${number}`>();
		expect(post.url({ params: { id: 7 } })).toBe("/posts/7");
		expect(post.url({ params: { id: 7n } })).toBe("/posts/7");

		const res = await new App().use(post).fetch("http://localhost/posts/7");
		expect(await res.text()).toBe('<a href="/posts/8">Next</a>');
	});

	test("links encode parameter values", async () => {
		const page = Route.get("/hello/:name");
		// a value cannot add segments, a query, or a fragment
		expect(page.url({ params: { name: "a/b?admin=1#x" } })).toBe(
			"/hello/a%2Fb%3Fadmin%3D1%23x",
		);
		expect(page.url({ params: { name: "Zoë" } })).toBe("/hello/Zo%C3%AB");
		expect(page.url({ params: { name: "a b" }, search: { q: "1" } })).toBe(
			"/hello/a%20b?q=1",
		);

		// a value cannot leave its segment as a dot segment or by being empty
		for (const name of ["..", ".", ""])
			expect(() =>
				Route.get("/users/:id/delete").url({ params: { id: name } }),
			).toThrow("cannot be a path segment");
		expect(() =>
			Route.get("/files/*").url({ params: { "*": "../../admin" } }),
		).toThrow("cannot be a path segment");
		// an encoded dot stays text
		expect(page.url({ params: { name: "%2e%2e" } })).toBe("/hello/%252e%252e");
		// a wildcard after other text
		expect(Route.get("/x*").url({ params: { "*": "a/b c" } })).toBe(
			"/xa/b%20c",
		);

		// the wildcard keeps its slashes
		const files = Route.get("/files/*");
		expect(files.url({ params: { "*": "images/my logo?.png" } })).toBe(
			"/files/images/my%20logo%3F.png",
		);

		// components build their URLs the same way
		const html = await new Render({
			markup: page.Anchor({
				params: { name: "a/b" },
				children: "Hi",
			}) as JSX.Element,
		}).string();
		expect(html).toContain('href="/hello/a%2Fb"');

		// the route matches it, with the original value
		const app = new App().use(
			Route.get("/hello/:name").use((c) => c.text(c.params.name)),
			Route.get("/files/*").use((c) => c.text(c.params["*"])),
		);
		const text = async (path: string) =>
			(await app.fetch("http://localhost" + path)).text();
		expect(await text(page.url({ params: { name: "a/b?c" } }))).toBe("a/b?c");
		expect(
			await text(files.url({ params: { "*": "images/my logo?.png" } })),
		).toBe("images/my logo?.png");
		// a wildcard keeps encoded separators, so it cannot gain segments
		expect(await text("/files/..%2Fsecret")).toBe("..%2Fsecret");
		expect(await text("/files/..%5Csecret")).toBe("..%5Csecret");
		// a malformed escape is left as sent
		expect(await text("/hello/100%")).toBe("100%");
	});

	test("each step returns the same route", () => {
		const route = Route.get("/posts");
		const handler = () => "posts";

		expect(route.describe("List posts").use(handler)).toBe(route);
		expect(route.middleware).toEqual([handler]);
		expect(route.description).toBe("List posts");
	});

	test("describe stores the description", () => {
		const remove = Route.post("/posts/:id/delete").describe("Delete a post");
		const undescribed = Route.post("/internal");

		expect(remove.description).toBe("Delete a post");
		expect(remove.tool.name()).toBe("post_posts_id_delete");
		expect(remove.tool).toMatchObject({
			title: "Delete a post",
			description: "Delete a post",
			read: false,
			destructive: true,
		});
		// a route that only adds, and a read, which never is
		expect(
			Route.post("/posts").describe("Create a post", { destructive: false })
				.tool.destructive,
		).toBe(false);
		expect(Route.get("/posts").describe("List posts").tool.destructive).toBe(
			false,
		);
		expect(undescribed.description).toBeUndefined();
		expect(() => undescribed.tool.name()).toThrow("has no tool to name");
		// an empty description would leave the route silently unserved
		// @ts-expect-error
		Route.post("/blank").describe("");
		// @ts-expect-error
		Route.post("/blank").describe(" \n\t ");
		// @ts-expect-error
		Route.post("/blank").describe(" \r ");
		// @ts-expect-error
		Route.post("/blank").describe("\u00a0");
		// @ts-expect-error
		Route.post("/blank").describe("\u3000\ufeff");
		Route.post("/padded").describe(" Text\u00a0");
	});

	test("a parameter cannot run into the wildcard", () => {
		void (() => {
			// nothing tells where the parameter ends and the wildcard starts
			// @ts-expect-error
			Route.get("/files/:id*");
			// @ts-expect-error
			Route.post("/files/:wildcard*");
			// @ts-expect-error
			new Route("GET", "/files/report-:id*");
		});

		// apart, or after other text, they are fine
		expectTypeOf(
			Route.get("/files/:id/*").pattern,
		).toEqualTypeOf<"/files/:id/*">();
		expect(
			Route.get("/files/:id/report-*").url({ params: { id: "1", "*": "x" } }),
		).toBe("/files/1/report-x");
		Route.get("/files-*");
		Route.get("/:a/:b");
	});

	test("params convert values before the middleware runs", async () => {
		const show = Route.get("/posts/:id/:slug")
			.params({ id: Schema.number().preprocess(Number).int() })
			.use((c) => {
				expectTypeOf(c.params).toEqualTypeOf<{ id: number; slug: string }>();

				return c.json(c.params);
			});
		const app = new App().use(show);

		const res = await app.fetch("http://localhost/posts/5/hello");

		expect(await res.json()).toEqual({ id: 5, slug: "hello" });
	});

	test("a parameter that fails its schema is a 404 before the middleware runs", async () => {
		let ran = false;
		const show = Route.get("/posts/:id")
			.params({ id: Schema.string().uuid() })
			.use(() => {
				ran = true;
			});
		const app = new App().use(show);

		const res = await app.fetch("http://localhost/posts/nope");

		expect(res.status).toBe(404);
		expect(ran).toBe(false);
	});

	test("fields keep their types after params, and params after fields", () => {
		const update = Route.post("/posts/:id")
			.fields({ title: Field.text() })
			.params({ id: Schema.string().uuid() })
			.use(async (c) => {
				const result = await c.data();
				if (result.issues) return;

				expectTypeOf(result.data.title).toEqualTypeOf<string>();
				expectTypeOf(c.params).toEqualTypeOf<{ id: string }>();
			});

		expect(forms.get(update)!.names).toEqual(["title"]);
	});
});
