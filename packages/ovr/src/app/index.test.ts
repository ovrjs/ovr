import { Field } from "../form/index.js";
import type { Middleware } from "../middleware/index.js";
import { Route } from "../route/index.js";
import { Method } from "../util/index.js";
import { App } from "./index.js";
import { describe, expect, test } from "vitest";

const app = new App({ trailingSlash: "always" });

test.each(["Text/HTML", "text/html ; charset=utf-8", "APPLICATION/XHTML+XML"])(
	"markup content stays escaped with Content-Type %s",
	async (type) => {
		const application = new App().use(
			Route.get("/").use((c) => {
				c.res.headers.set("content-type", type);
				return c.url.searchParams.get("message");
			}),
		);
		const response = await application.fetch(
			"https://example.com/?message=" +
				encodeURIComponent(
					'<img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="alert(1)"/>',
				),
		);
		expect(await response.text()).toBe(
			'&lt;img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="alert(1)"/>',
		);
	},
);

test("a mounted route's configuration is final", () => {
	const route = Route.get("/items/:id").describe("Item");
	new App().use(route);
	expect(() => route.describe("Other")).toThrow(
		'Call .describe() before app.use() on route "/items/:id".',
	);
	expect(() => route.params({})).toThrow("before app.use()");
	expect(() => route.fields({})).toThrow("before app.use()");
	expect(() => route.use(() => {})).toThrow("before app.use()");
	// so its tool name stays taken
	expect(() =>
		new App().use(route, Route.get("/items/id").describe("Other")),
	).toThrow('Tool name "get_items_id"');
});

const notFound: Middleware = async (c, next) => {
	await next();

	if (c.res.body === undefined) {
		c.res.status = 404;
		c.res.body = "Not found";
	}
};

const appFetch = (pathname: string, method: Route.Method = Method.get) =>
	app.fetch("http://localhost:5173" + pathname, { method });

test("context", () => {
	app.use(
		notFound,
		Route.get("/").use(
			async (c, next) => {
				c.res.headers.set("hello", "world");
				await next();
			},
			(c) => {
				expect(c.url).toBeInstanceOf(URL);
				expect(c.req).toBeInstanceOf(Request);
				expect(c.res.headers.get("hello")).toBe("world");

				c.text("hello world");
			},
		),
		Route.get("/api/:id/").use((c) => {
			expect(c.params.id).toBeDefined();
			c.json(c.params);
		}),
		Route.get("/wild/*").use((c) => {
			expect(c.params["*"]).toBeDefined();
			c.json(c.params);
		}),
		Route.post("/post/").use(async (c) => {
			const formData = await c.req.formData();
			c.json(formData.get("key"));
		}),
		Route.get("/page/").use(() => "page"),
	);
});

test("GET /", async () => {
	const res = await appFetch("/");
	const text = await res.text();

	expect(text).toBe("hello world");
});

test("a cookie-authenticated write needs browser origin evidence", async () => {
	let wrote = false;
	const app = new App().use(
		Route.post("/change").use(() => {
			wrote = true;
		}),
	);
	const response = await app.fetch("https://example.com/change", {
		method: "POST",
		headers: { cookie: "session=valid" },
	});
	expect(response.status).toBe(403);
	expect(wrote).toBe(false);
});

test("passes Request directly unless options are provided", async () => {
	const req = new Request("http://localhost:5173/request");
	const reuse = new App({ csrf: false }).use(
		Route.get("/request").use((c) => {
			expect(c.req).toBe(req);
			c.text("request");
		}),
		Route.post("/request").use((c) => {
			expect(c.req).not.toBe(req);
			c.text(c.req.method);
		}),
	);

	expect(await (await reuse.fetch(req)).text()).toBe("request");
	expect(await (await reuse.fetch(req, { ip: "192.0.2.1" })).text()).toBe(
		"request",
	);
	expect(await (await reuse.fetch(req, {})).text()).toBe("request");
	expect(await (await reuse.fetch(req, { method: Method.post })).text()).toBe(
		Method.post,
	);
});

test("server connection metadata preserves the original Request and is not inferred from headers", async () => {
	const req = new Request("https://example.com/", {
		headers: { "x-forwarded-for": "192.0.2.99" },
	});
	const app = new App().use(
		Route.get("/").use((c) => {
			expect(c.req).toBe(req);
			c.json({ ip: c.ip ?? null });
		}),
	);
	expect(await (await app.fetch(req, { ip: "192.0.2.1" })).json()).toEqual({
		ip: "192.0.2.1",
	});
	expect(await (await app.fetch(req)).json()).toEqual({ ip: null });
});

test("HEAD /", async () => {
	const res = await appFetch("/", Method.head);

	expect(res.status).toBe(200);
	expect(res.headers.get("hello")).toBe("world");
	expect(res.body).toBe(null);
});

test("GET /api/:id/", async () => {
	const res = await appFetch("/api/123/");
	const json = await res.json();

	expect(json.id).toBe("123");
});

test("GET /wild/*", async () => {
	const res = await appFetch("/wild/hello/");
	const json = await res.json();

	expect(json["*"]).toBe("hello/");
});

test("POST /post/", async () => {
	const body = new FormData();
	body.append("key", "value");

	const res = await app.fetch(
		new Request("http://localhost:5173/post/", {
			method: "post",
			body,
			headers: { origin: "http://localhost:5173" },
		}),
	);

	const json = await res.json();

	expect(json).toBe("value");
});

test("GET /not-found/", async () => {
	const res = await appFetch("/not-found/");
	const text = await res.text();

	expect(text).toBe("Not found");
	expect(res.status).toBe(404);
});

test("a returned Response keeps each cookie, and ones already set", async () => {
	const app = new App().use(
		Route.get("/cookies").use((c) => {
			c.cookie.set("earlier", "0");
			const headers = new Headers({ "x-kept": "yes" });
			headers.append("set-cookie", "a=1");
			headers.append("set-cookie", "b=2");
			return new Response("ok", { headers });
		}),
	);
	const res = await app.fetch("http://localhost:5173/cookies");
	expect(res.headers.get("x-kept")).toBe("yes");
	expect(res.headers.getSetCookie().map((c) => c.split(";")[0])).toEqual([
		"earlier=0",
		"a=1",
		"b=2",
	]);
});

describe("trailing slash", () => {
	test("always", async () => {
		const res = await appFetch("/api/123");

		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("http://localhost:5173/api/123/");
	});

	test("never", async () => {
		const nev = new App().use(Route.get("/test").use((c) => c.text("test")));

		const res = await nev.fetch(new Request("http://localhost:5173/test/"));

		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("http://localhost:5173/test");
	});

	test("a matched route's response is kept, its handler runs once", async () => {
		let ran = 0;
		const always = new App({ trailingSlash: "always" }).use(
			Route.get("/style.css").use((c) => {
				ran++;
				c.text("body{}");
			}),
		);
		const css = await always.fetch("http://localhost:5173/style.css");
		expect(css.status).toBe(200);
		expect(await css.text()).toBe("body{}");

		const never = new App().use(
			Route.post("/jobs/*").use((c) => {
				ran++;
				c.text("done");
			}),
		);
		const job = await never.fetch("http://localhost:5173/jobs/a/", {
			method: "POST",
			headers: { origin: "http://localhost:5173" },
		});
		expect(job.status).toBe(200);
		expect(ran).toBe(2);
	});

	test("only redirects to a path a route matches", async () => {
		const never = new App().use(Route.get("/test").use((c) => c.text("test")));
		const missing = await never.fetch("http://localhost:5173/missing/");
		expect(missing.status).not.toBe(308);
		expect(missing.headers.get("location")).toBeNull();
	});

	test("ignore", async () => {
		const ignore = new App({ trailingSlash: "ignore" }).use(
			notFound,
			Route.get("/nope").use((c) => c.text("nope")),
			Route.get("/yup/").use((c) => c.text("yup")),
		);

		expect(
			(await ignore.fetch(new Request("http://localhost:5173/nope"))).status,
		).toBe(200);
		expect(
			(await ignore.fetch(new Request("http://localhost:5173/nope/"))).status,
		).toBe(404);

		expect(
			(await ignore.fetch(new Request("http://localhost:5173/yup"))).status,
		).toBe(404);
		expect(
			(await ignore.fetch(new Request("http://localhost:5173/yup/"))).status,
		).toBe(200);
	});
});

test("html", async () => {
	const res = await appFetch("/page/");
	const text = await res.text();
	expect(res.status).toBe(200);
	expect(text).toBe("page");
});

test("etag", async () => {
	const r = new App().use(
		Route.get("/etag").use((c) => {
			const text = "hello world";
			const matched = c.etag("hello");

			if (matched) return;

			c.text(text);
		}),
	);

	const res = await r.fetch(new Request("http://localhost:5173/etag"));
	expect(res.status).toBe(200);
	expect(await res.text()).toBe("hello world");

	const etag = await r.fetch(
		new Request("http://localhost:5173/etag", {
			headers: { "if-none-match": res.headers.get("etag")! },
		}),
	);
	expect(etag.status).toBe(304);
	expect(await etag.text()).toBe("");
});

describe("a body the client got wrong, which the app does not catch", () => {
	const origin = "http://localhost";
	const headers = { origin, "sec-fetch-site": "same-origin" };
	const add = Route.post("/todos")
		.fields({ text: Field.text() })
		.use(async (c) => {
			await c.data();
			c.text("saved");
		});

	test("another content type is answered 415, naming the type to send", async () => {
		const res = await new App()
			.use(add)
			.fetch(`${origin}/todos`, {
				method: "POST",
				headers: { ...headers, "content-type": "application/json" },
				body: JSON.stringify({ text: "Buy milk" }),
			});

		expect(res.status).toBe(415);
		expect(await res.text()).toContain("multipart/form-data");
	});

	test("malformed form data is answered 400", async () => {
		const res = await new App()
			.use(add)
			.fetch(`${origin}/todos`, {
				method: "POST",
				headers: {
					...headers,
					"content-type": "multipart/form-data; boundary=x",
				},
				body: "not multipart",
			});

		expect(res.status).toBe(400);
	});

	test("a body over the limit is answered 413", async () => {
		const body = new FormData();
		body.set("text", "x".repeat(2048));
		const res = await new App({ form: { payload: 1024 } })
			.use(add)
			.fetch(`${origin}/todos`, { method: "POST", headers, body });

		expect(res.status).toBe(413);
	});

	test("the answer keeps headers set before the error, such as for CORS", async () => {
		const res = await new App()
			.use(async (c, next) => {
				c.res.headers.set("access-control-allow-origin", "*");
				c.html("<p>page</p>");
				await next();
			}, add)
			.fetch(`${origin}/todos`, {
				method: "POST",
				headers: { ...headers, "content-type": "application/json" },
				body: "{}",
			});

		expect(res.status).toBe(415);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
	});

	test("the app's own error handling still sees the error first", async () => {
		let caught: unknown;
		const res = await new App()
			.use(async (c, next) => {
				try {
					await next();
				} catch (error) {
					caught = error;
					c.text("handled", 422);
				}
			}, add)
			.fetch(`${origin}/todos`, {
				method: "POST",
				headers: { ...headers, "content-type": "application/json" },
				body: "{}",
			});

		expect(caught).toBeInstanceOf(TypeError);
		expect(res.status).toBe(422);
	});

	test("other errors still throw", async () => {
		const broken = Route.get("/broken").use(() => {
			throw new Error("bug");
		});

		await expect(
			new App().use(broken).fetch(`${origin}/broken`),
		).rejects.toThrow("bug");
	});
});
