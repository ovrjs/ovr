import * as o from "ovr";
import { jsx } from "ovr/jsx-runtime";
import { bench, describe } from "vitest";

async function Async() {
	return jsx("p", { children: "Async" });
}

function* Component() {
	for (let r = 0; r < 500; r++) {
		yield jsx("div", { children: [r, jsx(Async, { class: "text-sm" })] });
	}
}

describe("render", () => {
	bench("generate 500", async () => {
		const r = new o.Markup(jsx(Component, {}));
		for await (const _r of r);
	});
});

const app = new o.App();

app.use(
	o.Route.get("/").use(() => "home"),
	o.Route.get("/test").use(() => "test"),
	o.Route.get("/:slug").use((c) => c.params.slug),
	o.Route.get("/test/:slug").use((c) => c.params.slug),
	o.Route.get("/posts").use((c) => c.text("posts")),
	o.Route.get("/posts/:postId/comments").use(
		(c) => `comments for ${c.params.postId}`,
	),
	o.Route.get("/posts/:postId/comments/:commentId").use(
		(c) => `comment ${c.params.commentId} on post ${c.params.postId}`,
	),
	o.Route.get("/api/users").use(() => "users index"),
	o.Route.get("/api/users/:id").use((c) => `user ${c.params.id}`),
	o.Route.get("/static/*").use((c) => `static ${c.params["*"] ?? ""}`),
	o.Route.get("/assets/:type/:name").use(
		(c) => `${c.params.type}/${c.params.name}`,
	),
	o.Route.get("/files/:path").use((c) => `file ${c.params.path}`),
	o.Route.post("/api/users").use((c) => {
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
