import { Trie } from "../../ovr/dist/trie/index.js";
import { baseline } from "./baseline.js";
import * as o from "ovr";
import { bench, describe, expect } from "vitest";

const url = baseline("render");
const { Render: Before }: { Render: typeof o.Render } = await import(url);
const { JSX: Original }: { JSX: typeof o.JSX } = await import(
	baseline("jsx", { "../render/index.js": url })
);

function page(jsx: typeof o.JSX.jsx, count = 500) {
	return jsx("main", {
		children: Array.from({ length: count }, (_, i) =>
			jsx("p", { id: `row-${i}`, children: "Hello, world!" }),
		),
	});
}

expect((await Array.fromAsync(new Before(page(Original.jsx)))).join("")).toBe(
	(await Array.fromAsync(new o.Render(page(o.JSX.jsx)))).join(""),
);

const paths = [
	"/",
	"/test",
	"/foo",
	"/test/alpha",
	"/posts",
	"/posts/123/comments",
	"/posts/123/comments/456",
	"/api/users",
	"/api/users/42",
	"/static/js/app.js",
	"/assets/images/logo.png",
	"/files/path/to/file.txt",
];

const routes = [
	o.Route.get("/", () => "home"),
	o.Route.get("/test", () => "test"),
	o.Route.get("/:slug", (c) => c.params.slug),
	o.Route.get("/test/:slug", (c) => c.params.slug),
	o.Route.get("/posts", (c) => c.text("posts")),
	o.Route.get("/posts/:postId/comments", () => "comments"),
	o.Route.get("/posts/:postId/comments/:commentId", () => "comment"),
	o.Route.get("/api/users", () => "users"),
	o.Route.get("/api/users/:id", () => "user"),
	o.Route.get("/static/*", () => "static"),
	o.Route.get("/assets/:type/:name", () => "asset"),
	o.Route.get("/files/:path", () => "file"),
];

const app = new o.App().use(routes);
const trie = new Trie();
const options = { time: 2000, warmupTime: 1000, setup: () => global.gc?.() };

for (const route of routes) trie.add(route);

describe("routing hot path", () => {
	bench("match route trie", () => {
		for (let i = 0; i < 100; i++) {
			for (const path of paths) trie.find("GET" + path);
		}
	});

	bench("route requests", async () => {
		for (const path of paths) {
			await app.fetch("http://localhost:5173" + path);
		}
	});

	bench("route Request objects", async () => {
		for (const path of paths) {
			await app.fetch(new Request("http://localhost:5173" + path));
		}
	});
});

describe("rendering hot path", () => {
	bench(
		"render 500 sibling elements before chunk forwarding",
		async () => {
			for await (const _ of new Before(page(Original.jsx)));
		},
		options,
	);

	for (const count of [1, 10, 100, 500]) {
		bench(
			`render ${count} sibling elements`,
			async () => {
				for await (const _ of new o.Render(page(o.JSX.jsx, count)));
			},
			options,
		);
	}

	bench("render 100 fragments", async () => {
		for await (const _ of new o.Render(
			Array.from({ length: 100 }, (_, i) =>
				o.JSX.jsx(o.JSX.Fragment, { children: ["Hello, world!", i] }),
			),
		));
	});
});
