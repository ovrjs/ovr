import { Context } from "../context/index.js";
import { Route } from "../route/index.js";
import { Method } from "../util/index.js";
import { Trie } from "./index.js";
import { expect, test } from "vitest";

const c = new Context(new Request("https://localhost/"), {});

const trie = new Trie()
	.add(Route.get("/", () => "/"))
	.add(Route.get("/static/static", () => "/static/static"))
	.add(Route.get("/static/:param", () => "/static/:param"))
	.add(Route.get("/static/:param/:another", () => "/static/:param/:another"))
	.add(
		Route.get(
			"/static/:param/:another/static",
			() => "/static/:param/:another/static",
		),
	)
	.add(
		Route.get(
			"/static/:param/:another/static/static",
			() => "/static/:param/:another/static/static",
		),
	)
	.add(
		Route.get(
			"/static/:param/:another/static/different",
			() => "/static/:param/:another/static/different",
		),
	)
	.add(Route.get("/static/fork", () => "/static/fork"))
	.add(Route.get("/static/fork/:param", () => "/static/fork/:param"))
	.add(Route.get("/wild/*", () => "/wild/*"));

test("/", () => {
	const result = trie.find("GET/");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe("/");
	expect(result?.params).toStrictEqual({});
});

test("/static/static", () => {
	const result = trie.find("GET/static/static");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe(
		"/static/static",
	);
	expect(result?.params).toStrictEqual({});
});

test("/static/:param", () => {
	const result = trie.find("GET/static/param");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe(
		"/static/:param",
	);
	expect(result?.params).toStrictEqual({ param: "param" });
});

test("/static/:param/:another", () => {
	const result = trie.find("GET/static/param/another");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe(
		"/static/:param/:another",
	);
	expect(result?.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/:param/:another/static", () => {
	const result = trie.find("GET/static/param/another/static");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe(
		"/static/:param/:another/static",
	);
	expect(result?.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/:param/:another/static/static", () => {
	const result = trie.find("GET/static/param/another/static/static");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe(
		"/static/:param/:another/static/static",
	);
	expect(result?.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/:param/:another/static/different", () => {
	const result = trie.find("GET/static/param/another/static/different");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe(
		"/static/:param/:another/static/different",
	);
	expect(result?.params).toStrictEqual({ param: "param", another: "another" });
});

test("/static/fork", () => {
	const result = trie.find("GET/static/fork");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe("/static/fork");
	expect(result?.params).toStrictEqual({});
});

test("/static/fork/:param", () => {
	const result = trie.find("GET/static/fork/param");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe(
		"/static/fork/:param",
	);
	expect(result?.params).toStrictEqual({ param: "param" });
});

test("/wild/*", () => {
	const result = trie.find("GET/wild/whatever");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe("/wild/*");
	expect(result?.params).toStrictEqual({ "*": "whatever" });
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
	trie.add(Route.get("/*", () => "/*"));
	const result = trie.find("GET/whatever");
	expect(result?.route.middleware[0](c, Promise.resolve)).toBe("/*");
	expect(result?.params).toStrictEqual({ "*": "whatever" });
});
