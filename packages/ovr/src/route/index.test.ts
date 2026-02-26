import { App } from "../app/index.js";
import { Render } from "../render/index.js";
import { Schema } from "../schema/index.js";
import { Route } from "./index.js";
import { describe, expect, test } from "vitest";

describe("Route schema helpers", () => {
	test("Route.get parses query params with shape schema via c.data()", async () => {
		const search = Route.get(
			"/search",
			{
				query: Schema.Field.text(),
				tags: Schema.Field.multiselect(["a", "b", "c"]),
				active: Schema.Field.checkbox(),
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
		const app = new App({ trailingSlash: "ignore" }).use(search);

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

	test("Route.get parses query params with Schema.form instance", async () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			role: Schema.Field.radio(["reader", "admin"]),
		});
		const user = Route.get("/user", form, async (c) => {
			const result = await c.data();

			if (result.issues) {
				c.text("Invalid", 400);
				return;
			}

			c.json(result.data);
		});
		const app = new App({ trailingSlash: "ignore" }).use(user);

		const res = await app.fetch("http://localhost:5173/user?name=ross&role=admin");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ name: "ross", role: "admin" });
	});

	test("invalid GET schema parse uses current request URL and encoded _form", async () => {
		const search = Route.get(
			"/search",
			{ role: Schema.Field.radio(["reader", "admin"]) },
			async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			},
		);
		const app = new App({ trailingSlash: "ignore" }).use(search);

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
		const search = Route.get("/search", { query: Schema.Field.text() }, async (c) => {
			const result = await c.data();

			if (result.issues) {
				c.text("Invalid", 400);
				return;
			}

			c.text(result.data.query);
		});
		const app = new App({ trailingSlash: "ignore" }).use(search);

		const res = await app.fetch(
			new Request("http://localhost:5173/search?query=hello", {
				method: "HEAD",
			}),
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("location")).toBeNull();
	});

	test("schema-enabled Route.get exposes route and schema helpers", () => {
		const form = Route.get(
			"/profile",
			{ name: Schema.Field.text() },
			(c) => c.text("ok"),
		);

		expect(typeof form.Anchor).toBe("function");
		expect(typeof form.Form).toBe("function");
		expect(typeof form.Button).toBe("function");
		expect(typeof form.Fields).toBe("function");
		expect(typeof form.Field).toBe("function");
	});

	test("schema-enabled Route.get Form defaults to Fields and submit button", async () => {
		const profile = Route.get(
			"/profile",
			{ name: Schema.Field.text() },
			(c) => c.text("ok"),
		);

		const html = await new Render(null).string(profile.Form({}));

		expect(html.includes("action=\"/profile\"")).toBe(true);
		expect(html.includes("method=\"GET\"")).toBe(true);
		expect(html.includes("name=\"name\"")).toBe(true);
		expect(html.includes(">Submit</button>")).toBe(true);
	});

	test("invalid POST schema parse still prefers same-origin referer URL", async () => {
		const submit = Route.post(
			"/submit",
			{ role: Schema.Field.radio(["reader", "admin"]) },
			async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				c.text("ok");
			},
		);
		const app = new App({ trailingSlash: "ignore" }).use(submit);
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
			{
				name: Schema.Field.text().min(2),
				license: Schema.Field.file().part(),
			},
			async (c) => {
				const result = await c.data();

				if (result.issues) {
					c.redirect(result.url, 303);
					return;
				}

				if (result.parts) {
					for await (const part of result.parts) {
						await part.bytes();
					}
				}

				c.text("ok");
			},
		);
		const app = new App({ trailingSlash: "ignore" }).use(submit);
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
			{
				a: Schema.Field.text(),
				b: Schema.Field.text(),
			},
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
		const app = new App({ trailingSlash: "ignore" }).use(submit);
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
});
