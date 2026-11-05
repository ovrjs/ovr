import { App } from "../app/index.js";
import { Render } from "../render/index.js";
import { Field, Form, Schema } from "../schema/index.js";
import { Route } from "./index.js";
import { describe, expect, expectTypeOf, test } from "vitest";

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
		await expect(
			new App()
				.use(route)
				.fetch("https://example.com/upload", {
					method: "POST",
					headers: { "content-type": "multipart/form-data; boundary=audit" },
					body,
					...{ duplex: "half" },
				}),
		).rejects.toThrow("Payload Too Large");
		expect(canceled).toBe(true);
	});

	test("later parameter conversion cannot change the type seen by earlier middleware", async () => {
		const route = Route.get("/items/:id").use((c) =>
			c.text(c.params.id.toUpperCase()),
		);
		try {
			route.params({ id: Schema.number().preprocess(Number) });
		} catch (error) {
			// Rejecting this order at setup also prevents a request-time type error.
			if (!(error instanceof TypeError)) throw error;
		}
		const response = await new App()
			.use(route)
			.fetch("http://localhost/items/42");
		expect(await response.text()).toBe("42");
	});

	test("Route.get parses query params with shape schema via c.data()", async () => {
		const search = Route.get("/search")
			.fields({
				query: Field.text(),
				tags: Field.multiselect(["a", "b", "c"]),
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

	test("Route.get parses query params with Form.from instance", async () => {
		const form = Form.from({
			name: Field.text(),
			role: Field.radio(["reader", "admin"]),
		});
		const user = Route.get("/user")
			.fields(form)
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

	test("invalid GET schema parse uses current request URL and encoded _form", async () => {
		const search = Route.get("/search")
			.fields({ role: Field.radio(["reader", "admin"]) })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			});
		const app = new App().use(search);

		const res = await app.fetch(
			new Request("http://localhost:5173/search?role=owner", {
				headers: { referer: "http://localhost:5173/source?from=referer" },
			}),
		);

		expect(res.status).toBe(303);

		const location = res.headers.get("location");
		if (!location) throw new Error("Expected redirect location");

		const url = new URL(location);

		expect(url.pathname).toBe("/search");
		expect(url.searchParams.get("role")).toBe("owner");
		expect(url.searchParams.get("from")).toBeNull();
		expect(url.searchParams.get("_form")).toBeTruthy();
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
		expect(typeof form.Fields).toBe("function");
		expect(typeof form.Field).toBe("function");
	});

	test("schema-enabled Route.get Form defaults to Fields and submit button", async () => {
		const profile = Route.get("/profile")
			.fields({ name: Field.text() })
			.use((c) => c.text("ok"));

		const html = await Render.string(profile.Form({}));

		expect(html.includes('action="/profile"')).toBe(true);
		expect(html.includes('method="GET"')).toBe(true);
		expect(html.includes('name="name"')).toBe(true);
		expect(html.includes(">Submit</button>")).toBe(true);
	});

	test("schema-enabled Route.post Form encodes _return from URL state", async () => {
		const submit = Route.post("/submit")
			.fields({ name: Field.text() })
			.use((c) => c.text("ok"));
		const state = new URL(
			"http://localhost:5173/signup?tab=profile&_form=stale&_return=%2Fold#details",
		);
		const html = await Render.string(submit.Form({ state }));

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

	test("invalid POST schema parse exposes search object for explicit page redirects", async () => {
		const page = Route.get("/source").use((c) => c.text("source"));
		const submit = Route.post("/submit")
			.fields({ role: Field.radio(["reader", "admin"]) })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(page.url({ search: result.search }), 303);
					return;
				}

				c.text("ok");
			});
		const app = new App().use(page).use(submit);
		const data = new FormData();

		data.set("role", "owner");

		const res = await app.fetch(
			new Request("http://localhost:5173/submit", {
				method: "POST",
				body: data,
				headers: { origin: "http://localhost:5173" },
			}),
		);

		expect(res.status).toBe(303);

		const location = res.headers.get("location");
		if (!location) throw new Error("Expected redirect location");

		const url = new URL(location, "http://localhost:5173");

		expect(url.pathname).toBe("/source");
		expect(url.searchParams.get("_form")).toBeTruthy();
		expect(url.searchParams.get("_return")).toBeNull();
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

		await expect(
			app.fetch(
				new Request("http://localhost:5173/limit", {
					method: "POST",
					body: data,
					headers: { origin: "http://localhost:5173" },
				}),
			),
		).rejects.toThrow("Too Many Parts");
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

		await expect(
			app.fetch(
				new Request("http://localhost:5173/auto-limit", {
					method: "POST",
					body: data,
					headers: { origin: "http://localhost:5173" },
				}),
			),
		).rejects.toThrow("Too Many Parts");
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
		const app = new App({ form: { parts: 1 } }).use(submit);
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
		const app = new App({ form: { parts: 1 } }).use(submit);
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
		const html = await Render.string(
			update.Form({ params: { id: "1" }, values: post }),
		);

		expect(html).toContain('value="Draft"');
		expect(html).toContain(">Text</textarea>");
		expect(html).toContain("checked");
		expect(html).not.toContain("values=");
		expect(html).not.toContain("not a file");

		// submitted values restored from the URL override the record
		const state = new URL("http://localhost:5173/posts/1?title=Typed");
		const restored = await Render.string(
			update.Form({ params: { id: "1" }, values: post, state }),
		);

		expect(restored).toContain('value="Typed"');
		expect(restored).toContain(">Text</textarea>");
	});

	test("Form labels its submit button", async () => {
		const update = Route.post("/posts/:id")
			.fields(fields)
			.use((c) => c.text("ok"));
		const html = await Render.string([
			update.Form({ params: { id: "1" }, submit: "Save changes" }),
			update.Form({ params: { id: "1" } }),
		]);

		expect(html).toContain("<button>Save changes</button>");
		expect(html).toContain("<button>Submit</button>");
		expect(html).not.toContain("submit=");
	});

	test("Field and component accept initial values too", async () => {
		const form = Form.from(fields);
		const html = await Render.string([
			form.Field({ name: "title", values: { title: "One" } }),
			form.component({ name: "body", values: { body: "Two" } }).Control(),
		]);

		expect(html).toContain('value="One"');
		expect(html).toContain(">Two</textarea>");
	});

	test("initial record values are not limited by the URL persistence budget", async () => {
		const update = Route.post("/posts/:id")
			.fields({ body: Field.textarea() })
			.use((c) => c.text("ok"));
		const body = "Article text. ".repeat(100);
		const html = await Render.string(
			update.Form({ params: { id: "1" }, values: { body } }),
		);

		expect(html).toContain(`>${body}</textarea>`);
	});

	test.each(["parse", "database"])(
		"cleared persisted fields override initial values after a %s error",
		async (failure) => {
			const form = Form.from({
				title: Field.text().optional().persist(),
				tags: Field.multiselect(["a", "b"]).optional().persist(),
				email: Field.email().persist(),
			});
			const input = new FormData();
			input.set("title", "");
			input.set("email", failure === "parse" ? "invalid" : "taken@example.com");
			const parsed = await form.parse(input);
			const result = parsed.issues
				? parsed
				: parsed.invalid({ email: "Already registered" });
			const state = new URL("https://example.com/edit");
			for (const pair of result.search ?? []) state.searchParams.set(...pair);
			const html = await Render.string(
				form.Fields({ state, values: { title: "Old title", tags: ["a"] } }),
			);

			expect(html).not.toContain('value="Old title"');
			expect(html).not.toContain("selected");
		},
	);
});

describe("invalid after parsing", () => {
	test("puts issues on fields and keeps persisted values", async () => {
		const page = Route.get("/signup").use((c) => signup.Form({ state: c.url }));
		const signup = Route.post("/signup")
			.fields({ email: Field.email().persist(), name: Field.text() })
			.use(async (c) => {
				const result = await c.data();

				if (result.issues) return c.redirect(result.url, 303);

				// for example, a unique constraint rejected the insert
				return c.redirect(
					result.invalid({ email: "Already registered" }).url,
					303,
				);
			});
		const app = new App().use(page, signup);
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

		const html = await (await app.fetch(location)).text();

		expect(html).toContain("Already registered");
		expect(html).toContain('value="taken@example.com"');
		expect(html).toContain('aria-invalid="true"');
		// name is not persisted
		expect(html).not.toContain("Ross");
	});
});

describe("chained routes", () => {
	test("forms are WebMCP tools for browser agents", async () => {
		const render = (element: unknown) =>
			Render.string(element as Parameters<typeof Render.string>[0]);

		// a form that may change data waits for the user to submit it
		const create = Route.post("/posts")
			.describe("Create a post")
			.fields({ title: Field.text() });
		const created = await render(create.Form({}));
		expect(created).toContain(
			'toolname="post_posts" tooldescription="Create a post"',
		);
		expect(created).not.toContain("toolautosubmit");

		// a search the agent submits itself
		const search = Route.get("/search")
			.describe("Search posts")
			.fields({ q: Field.search() });
		expect(await render(search.Form({}))).toContain(
			'toolname="get_search" tooldescription="Search posts" toolautosubmit',
		);

		// a form per record would repeat the name, and only described routes are tools
		const remove = Route.post("/posts/:id/delete").describe("Delete a post");
		const login = Route.post("/login").describe(false);
		for (const html of [
			await render(remove.Form({ params: { id: "1" } })),
			await render(login.Form({})),
			await render(Route.post("/internal").Form({})),
			await render(Route.get("/about").Form({})),
		])
			expect(html).not.toContain("toolname");

		// props override them
		expect(
			await render(
				remove.Form({
					params: { id: "1" },
					toolname: "delete_post",
					tooldescription: "Delete this post",
				}),
			),
		).toContain('toolname="delete_post" tooldescription="Delete this post"');
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

	test("params checks whole parameter names, and redirects need their values", async () => {
		expect(() =>
			// @ts-expect-error not a parameter of the pattern
			Route.get("/items/:id").params({ i: Field.text() }),
		).toThrow('has no parameter "i"');

		const item = Route.get("/items/:id").use((c) => c.text(c.params.id));
		const app = new App().use(
			item,
			Route.get("/go").use((c) => c.redirect(item, 303)),
		);
		await expect(app.fetch("http://localhost/go")).rejects.toThrow(
			"route.url({ params })",
		);
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
		const html = await Render.string(
			page.Anchor({ params: { name: "a/b" }, children: "Hi" }) as Parameters<
				typeof Render.string
			>[0],
		);
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

	test("describe stores the description, and false hides the route", () => {
		const remove = Route.post("/posts/:id/delete").describe("Delete a post");
		const hidden = Route.post("/internal").describe(false);

		expect(remove.description).toBe("Delete a post");
		expect(remove.tool).toEqual({
			name: "post_posts_id_delete",
			description: "Delete a post",
			read: false,
		});
		expect(hidden.description).toBe(false);
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

	test("params rejects names the pattern does not have", () => {
		expect(() =>
			// @ts-expect-error - not a parameter of the pattern
			Route.get("/posts/:id").params({ ids: Schema.string() }),
		).toThrow('Route "/posts/:id" has no parameter "ids".');
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

		expect(update.names).toEqual(["title"]);
	});
});
