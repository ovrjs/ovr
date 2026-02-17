import { App } from "../app/index.js";
import { Route } from "../route/index.js";
import { describe, expect, test } from "vitest";

describe("auth sessions", () => {
	test("invalid session cookie logs out instead of throwing", async () => {
		const app = new App({ auth: { secret: "secret" }, trailingSlash: "ignore" });

		app.use(
			Route.get("/", async (c) => {
				c.json(await c.auth.session());
			}),
		);

		const res = await app.fetch(
			new Request("https://example.com/", {
				headers: { cookie: "__Host-auth-session=bad" },
			}),
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toBeNull();
		expect(res.headers.get("set-cookie")).toContain("__Host-auth-session=");
		expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
	});
});

describe("passkey script", () => {
	test("serialize signed payload safely", async () => {
		const app = new App({ auth: { secret: "secret" }, csrf: false });

		const register = Route.post("/register", (c) => c.text("ok"));

		app.use(
			register,
			Route.get("/", (c) => {
				const Register = c.auth.passkey.create(register, undefined, "o'connor");
				return Register({});
			}),
		);

		const res = await app.fetch("https://example.com/");
		const html = await res.text();
		const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

		expect(script).toBeDefined();
		expect(() => new Function(script!)).not.toThrow();
	});
});
