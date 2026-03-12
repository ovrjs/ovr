import { App } from "../app/index.js";
import { Render } from "../render/index.js";
import { Field, Form } from "../schema/index.js";
import { Route } from "./index.js";
import { describe, expect, test } from "vitest";

describe("Route schema helpers", () => {
	test("Route.get parses query params with shape schema via c.data()", async () => {
		const search = Route.get(
			"/search",
			{
				query: Field.text(),
				tags: Field.multiselect(["a", "b", "c"]),
				active: Field.checkbox(),
			},
			async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.json({ issues: result.issues.length }, 400);
					return;
				}

				c.json(result.data);
			},
		);
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
		const user = Route.get("/user", form, async (c) => {
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
		const search = Route.get(
			"/search",
			{ role: Field.radio(["reader", "admin"]) },
			async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			},
		);
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
		const search = Route.get("/search", { query: Field.text() }, async (c) => {
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
		const form = Route.get("/profile", { name: Field.text() }, (c) =>
			c.text("ok"),
		);

		expect(typeof form.Anchor).toBe("function");
		expect(typeof form.Form).toBe("function");
		expect(typeof form.Button).toBe("function");
		expect(typeof form.Fields).toBe("function");
		expect(typeof form.Field).toBe("function");
	});

	test("schema-enabled Route.get Form defaults to Fields and submit button", async () => {
		const profile = Route.get("/profile", { name: Field.text() }, (c) =>
			c.text("ok"),
		);

		const html = await new Render(null).string(profile.Form({}));

		expect(html.includes('action="/profile"')).toBe(true);
		expect(html.includes('method="GET"')).toBe(true);
		expect(html.includes('name="name"')).toBe(true);
		expect(html.includes(">Submit</button>")).toBe(true);
	});

	test("invalid POST schema parse still prefers same-origin referer URL", async () => {
		const submit = Route.post(
			"/submit",
			{ role: Field.radio(["reader", "admin"]) },
			async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			},
		);
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

		expect(url.pathname).toBe("/source");
		expect(url.searchParams.get("from")).toBe("referer");
		expect(url.searchParams.get("_form")).toBeTruthy();
	});

	test("invalid multipart POST with streamed file field returns redirect", async () => {
		const submit = Route.post(
			"/upload",
			{ name: Field.text().min(2), license: Field.file().stream() },
			async (c) => {
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
			},
		);
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
		const submit = Route.post(
			"/limit",
			{ a: Field.text(), b: Field.text() },
			async (c) => {
				try {
					const result = await c.data({ parts: 1 });

					if (result.issues) {
						c.text("invalid", 400);
						return;
					}

					c.json(result.data);
				} catch (error) {
					c.text(error instanceof Error ? error.message : String(error), 413);
				}
			},
		);
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

	test("c.data returns null on routes without a schema", async () => {
		const noSchema = Route.get("/no-schema", async (c) => {
			const result = await c.data();
			c.text(result === null ? "ok" : "bad");
		});
		const app = new App().use(noSchema);
		const res = await app.fetch("http://localhost:5173/no-schema");

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	test("c.data auto-applies schema parts limit", async () => {
		const submit = Route.post(
			"/auto-limit",
			{ a: Field.text(), b: Field.text() },
			async (c) => {
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
			},
		);
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
		const submit = Route.post(
			"/app-limit",
			{ a: Field.text(), b: Field.text() },
			async (c) => {
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
			},
		);
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
		const submit = Route.post(
			"/call-limit",
			{ a: Field.text(), b: Field.text() },
			async (c) => {
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
			},
		);
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
