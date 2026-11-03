import { Context } from "../context/index.js";
import { Route } from "../route/index.js";
import { Method } from "../util/index.js";
import { Trie } from "./index.js";
import { expect, test } from "vitest";

const c = new Context(new Request("https://localhost/"), {});

const trie = new Trie()
	.add(Route.get("/").use(() => "/"))
	.add(Route.get("/static/static").use(() => "/static/static"))
	.add(Route.get("/static/:param").use(() => "/static/:param"))
	.add(
		Route.get("/static/:param/:another").use(() => "/static/:param/:another"),
	)
	.add(
		Route.get("/static/:param/:another/static").use(
			() => "/static/:param/:another/static",
		),
	)
	.add(
		Route.get("/static/:param/:another/static/static").use(
			() => "/static/:param/:another/static/static",
		),
	)
	.add(
		Route.get("/static/:param/:another/static/different").use(
			() => "/static/:param/:another/static/different",
		),
	)
	.add(Route.get("/static/fork").use(() => "/static/fork"))
	.add(Route.get("/static/fork/:param").use(() => "/static/fork/:param"))
	.add(Route.get("/wild/*").use(() => "/wild/*"));

const match = (path: string) => {
	const result = trie.find(path);
	if (result == null) throw new Error(`Expected route for ${path}`);

	const middleware = result.route.middleware[0];
	if (middleware == null) throw new Error(`Expected middleware for ${path}`);

	return { params: result.params, value: middleware(c, Promise.resolve) };
};

test("/", () => {
	const result = match("GET/");
	expect(result.value).toBe("/");
	expect(result.params).toStrictEqual({});
});

test("/static/static", () => {
	const result = match("GET/static/static");
	expect(result.value).toBe("/static/static");
	expect(result.params).toStrictEqual({});
});

test("/static/:param", () => {
	const result = match("GET/static/param");
	expect(result.value).toBe("/static/:param");
	expect(result.params).toStrictEqual({ param: "param" });
});

test("/static/:param/:another", () => {
	const result = match("GET/static/param/another");
	expect(result.value).toBe("/static/:param/:another");
	expect(result.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/:param/:another/static", () => {
	const result = match("GET/static/param/another/static");
	expect(result.value).toBe("/static/:param/:another/static");
	expect(result.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/:param/:another/static/static", () => {
	const result = match("GET/static/param/another/static/static");
	expect(result.value).toBe("/static/:param/:another/static/static");
	expect(result.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/:param/:another/static/different", () => {
	const result = match("GET/static/param/another/static/different");
	expect(result.value).toBe("/static/:param/:another/static/different");
	expect(result.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/fork", () => {
	const result = match("GET/static/fork");
	expect(result.value).toBe("/static/fork");
	expect(result.params).toStrictEqual({});
});

test("/static/fork/:param", () => {
	const result = match("GET/static/fork/param");
	expect(result.value).toBe("/static/fork/:param");
	expect(result.params).toStrictEqual({ param: "param" });
});

test("/wild/*", () => {
	const result = match("GET/wild/whatever");
	expect(result.value).toBe("/wild/*");
	expect(result.params).toStrictEqual({ "*": "whatever" });
});

test("/nope", () => {
	const result = trie.find("GET/nope");
	expect(result).toBe(null);
});

test("/static//static", () => {
	const result = trie.find("GET/static//static");
	expect(result).toBe(null);
});

test("Empty path", () => {
	const result = trie.find(Method.get);
	expect(result).toBe(null);
});

test("/static/ (trailing slash)", () => {
	const result = trie.find("GET/static/");
	expect(result).toBe(null);
});

test("/*", () => {
	trie.add(Route.get("/*").use(() => "/*"));
	const result = match("GET/whatever");
	expect(result.value).toBe("/*");
	expect(result.params).toStrictEqual({ "*": "whatever" });
});

test("conflicting param names at same segment throw", () => {
	const trie = new Trie().add(Route.get("/:id").use(() => "/:id"));

	expect(() => trie.add(Route.get("/:name").use(() => "/:name"))).toThrow(
		'Conflicting param names "id" and "name"',
	);
});
