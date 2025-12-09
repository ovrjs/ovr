import * as o from "ovr";
import { bench, describe } from "vitest";

async function Async() {
	return o.jsx("p", { children: "Async" });
}

function* Component() {
	for (let r = 0; r < 500; r++) {
		yield o.jsx("div", { children: [r, o.jsx(Async, { class: "text-sm" })] });
	}
}

describe("render", () => {
	bench("generate 500", async () => {
		const r = new o.Render(o.jsx(Component, {}));
		for await (const _r of r);
	});
});

const app = new o.App();

app.use(
	o.Route.get("/", () => "home"),
	o.Route.get("/test", () => "test"),
	o.Route.get("/:slug", (c) => c.params.slug),
	o.Route.get("/test/:slug", (c) => c.params.slug),
	o.Route.get("/posts", (c) => c.text("posts")),
	o.Route.get(
		"/posts/:postId/comments",
		(c) => `comments for ${c.params.postId}`,
	),
	o.Route.get(
		"/posts/:postId/comments/:commentId",
		(c) => `comment ${c.params.commentId} on post ${c.params.postId}`,
	),
	o.Route.get("/api/users", () => "users index"),
	o.Route.get("/api/users/:id", (c) => `user ${c.params.id}`),
	o.Route.get("/static/*", (c) => `static ${c.params["*"] ?? ""}`),
	o.Route.get(
		"/assets/:type/:name",
		(c) => `${c.params.type}/${c.params.name}`,
	),
	o.Route.get("/files/:path", (c) => `file ${c.params.path}`),
	o.Route.post("/api/users", (c) => {
		return c.json({ created: true });
	}),
);

describe("router", () => {
	bench("router - match various routes", async () => {
		const paths = [
			"/",
			"/test",
			"/foo", // matches :slug
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

		// run many iterations to exercise the router
		for (let i = 0; i < 1000; i++) {
			for (const p of paths) {
				// call the app handler; support sync/async handlers by awaiting the result
				await app.fetch("http://localhost:5173" + p);
			}
		}
	});
});
