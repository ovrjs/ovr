import type { Middleware } from "../middleware/index.js";
import { Route } from "../route/index.js";
import type { Method } from "../types/index.js";
import { App } from "./index.js";
import { describe, expect, test } from "vitest";

const app = new App({ trailingSlash: "always" });

const notFound: Middleware = async (c, next) => {
	await next();

	if (c.res.body === undefined) {
		c.res.status = 404;
		c.res.body = "Not found";
	}
};

const appFetch = (pathname: string, method: Method = "GET") =>
	app.fetch("http://localhost:5173" + pathname, { method });

test("context", () => {
	app.use(
		notFound,
		Route.get(
			"/",
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
		Route.get("/api/:id/", (c) => {
			expect(c.params.id).toBeDefined();
			c.json(c.params);
		}),
		Route.get("/wild/*", (c) => {
			expect(c.params["*"]).toBeDefined();
			c.json(c.params);
		}),
		Route.post("/post/", async (c) => {
			const formData = await c.req.formData();
			c.json(formData.get("key"));
		}),
		Route.get("/page/", () => "page"),
	);
});

test("GET /", async () => {
	const res = await appFetch("/");
	const text = await res.text();

	expect(text).toBe("hello world");
});

test("HEAD /", async () => {
	const res = await appFetch("/", "HEAD");

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

describe("trailing slash", () => {
	test("always", async () => {
		const res = await appFetch("/api/123");

		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("http://localhost:5173/api/123/");
	});

	test("never", async () => {
		const nev = new App().use(Route.get("/test", (c) => c.text("test")));

		const res = await nev.fetch(new Request("http://localhost:5173/test/"));

		expect(res.status).toBe(308);
		expect(res.headers.get("location")).toBe("http://localhost:5173/test");
	});

	test("ignore", async () => {
		const ignore = new App({ trailingSlash: "ignore" }).use(
			notFound,
			Route.get("/nope", (c) => c.text("nope")),
			Route.get("/yup/", (c) => c.text("yup")),
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
		Route.get("/etag", (c) => {
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
