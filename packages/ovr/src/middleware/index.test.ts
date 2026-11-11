import { App } from "../app/index.js";
import { Field } from "../form/index.js";
import { Route } from "../route/index.js";
import { Schema } from "../schema/index.js";
import type { Middleware } from "./index.js";
import { expect, expectTypeOf, test } from "vitest";

test("middleware written on its own runs on any route, and globally", async () => {
	const seen: string[] = [];
	const log: Middleware = async (c, next) => {
		const result = await c.data();

		expectTypeOf(result?.issues).toEqualTypeOf<
			readonly [Schema.Issue, ...Schema.Issue[]] | undefined
		>();
		seen.push(result ? (result.issues ? "invalid" : "valid") : "none");
		await next();
	};
	const post = Route.post("/posts")
		.fields({ title: Field.text() })
		.use(log, (c) => c.text("ok"));
	const get = Route.get("/posts/:id")
		.params({ id: Schema.number().preprocess(Number).int() })
		.use(log, (c) => {
			expectTypeOf(c.params.id).toEqualTypeOf<number>();
			c.text("ok");
		});
	const page = Route.get("/").use(log, (c) => c.text("ok"));
	const app = new App().use(log, post, get, page);
	const body = new FormData();
	body.set("title", "Hello");

	await app.fetch(
		new Request("http://localhost/posts", {
			method: "POST",
			body,
			headers: { origin: "http://localhost" },
		}),
	);
	expect((await app.fetch("http://localhost/posts/1")).status).toBe(200);
	expect((await app.fetch("http://localhost/")).status).toBe(200);

	expect(seen).toEqual(["valid", "valid", "none", "none", "none", "none"]);
});
