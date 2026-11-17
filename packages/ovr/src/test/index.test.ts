import { App } from "../app/index.js";
import { Auth } from "../auth/index.js";
import { Database } from "../database/index.js";
import { Field } from "../form/index.js";
import { jsx } from "../jsx/index.js";
import { Mcp } from "../mcp/index.js";
import { Route } from "../route/index.js";
import { Schema } from "../schema/index.js";
import { Table } from "../table/index.js";
import { Tester } from "./index.js";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

const origin = "https://example.com";

const engine = await PGlite.create();
let turn = Promise.resolve();
const acquire = () => {
	let release!: () => void;
	const previous = turn;
	turn = new Promise((resolve) => (release = resolve));
	return previous.then(() => release);
};
const run = async (text: string, values?: unknown[]) =>
	values?.length
		? engine.query(text, values)
		: ((await engine.exec(text)).at(-1) ?? { rows: [] });
const users = new Table("users", { id: Schema.string(), email: Field.email() });
const pool: Database.Pool = {
	async query(text, values) {
		const release = await acquire();
		try {
			return await run(text, values);
		} finally {
			release();
		}
	},
	async connect() {
		return { query: run, release: await acquire() };
	},
};
const database = new Database(pool, [users, ...Auth.tables]);
await database.migrate([
	{
		id: "0001_users",
		sql: "CREATE TABLE users (id text PRIMARY KEY, email text NOT NULL)",
	},
]);

beforeEach(async () => {
	await engine.exec(
		"TRUNCATE users, auth_credentials, auth_sessions, auth_challenges, rate_limits, auth_tokens, auth_links",
	);
	await engine.exec(
		"INSERT INTO users VALUES ('ross', 'ross@example.com'), ('sam', 'sam@example.com')",
	);
});
afterAll(() => engine.close());

/** An app with sign-in, an MCP endpoint, and routes that say what they got. */
function setup() {
	const auth = new Auth({
		secret: "s".repeat(32),
		origin,
		database,
		users,
		page: "/login",
	});
	/** What each route was last sent */
	const got: { data?: unknown; updates?: unknown; file?: string } = {};

	const whoami = Route.get("/whoami")
		.describe("Who is signed in")
		.use(async (c) => c.json({ user: (await c.session())?.user ?? null }));

	const page = Route.get("/page")
		.describe("A page")
		.use(() => jsx("main", { children: jsx("h1", { children: "Hello" }) }));

	const search = Route.get("/search")
		.describe("Search recipes")
		.fields({
			q: Field.search().optional(),
			tags: Field.checkboxes(["a", "b"]).optional(),
		})
		.use(async (c) => {
			const result = await c.data();
			return c.json({ url: c.url.search, data: result.data ?? null });
		});

	const create = Route.post("/recipes")
		.describe("Add a recipe", { destructive: false })
		.fields({
			title: Field.text().min(1).persist(),
			servings: Field.number().optional(),
			vegan: Field.checkbox(),
			steps: Field.textarea().lines().optional(),
			ingredients: Field.list({
				name: Field.text(),
				amount: Field.text().optional(),
			}).optional(),
			photo: Field.file().optional(),
		})
		.use(async (c) => {
			if (!(await c.session())) return c.redirect("/login", 303);
			const result = await c.data();
			if (result.issues) return c.redirect(result.url, 303);
			const { photo, ...data } = result.data;
			got.data = data;
			got.updates = Object.keys(result.updates).sort();
			if (photo) got.file = `${photo.name} ${photo.type} ${await photo.text()}`;
			return c.redirect("/recipes/1", 303);
		});

	const update = Route.post("/recipes/:id")
		.describe("Change a recipe")
		.fields({ title: Field.text().min(1) })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return c.redirect(result.url, 303);
			return c.json({ id: c.params.id, title: result.data.title });
		});

	const remove = Route.post("/recipes/:id/delete").use((c) =>
		c.redirect("/recipes", 303),
	);

	const file = Route.get("/files/*")
		.describe("Read a file")
		.use((c) => c.text(c.params["*"]));

	const cookies = Route.post("/cookies").use((c) => {
		c.cookie.set("seen", "yes");
		c.cookie.set("scoped", "yes", { path: "/whoami" });
		return c.text("set");
	});
	const forget = Route.post("/cookies/forget").use((c) => {
		c.cookie.set("seen", "", { maxAge: 0 });
		return c.text("forgotten");
	});
	const sent = Route.get("/cookies").use((c) =>
		c.json({
			seen: c.cookie.get("seen") ?? null,
			scoped: c.cookie.get("scoped") ?? null,
		}),
	);

	const agents = Route.get("/agents").use(async (c) =>
		c.json(await auth.agents(c)),
	);
	const disconnect = Route.post("/agents/disconnect")
		.fields({ client: Field.hidden() })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return c.redirect(result.url, 303);
			await auth.disconnect(c, result.data.client);
			return c.redirect("/agents", 303);
		});

	const routes = {
		whoami,
		page,
		search,
		create,
		update,
		remove,
		file,
		cookies,
		forget,
		sent,
		agents,
		disconnect,
	};
	const app = new App().use(auth, new Mcp({ auth }), routes);

	return { app, auth, got, ...routes };
}

describe("fetch", () => {
	test("is signed out without a user", async () => {
		const { app, whoami } = setup();
		const res = await new Tester({ app }).fetch(whoami);

		expect(await res.json()).toEqual({ user: null });
	});

	test("signs the user in without a passkey", async () => {
		const { app, whoami } = setup();
		const ross = new Tester({ app, user: "ross" });
		const sam = new Tester({ app, user: "sam" });

		expect(await (await ross.fetch(whoami)).json()).toEqual({ user: "ross" });
		expect(await (await sam.fetch(whoami)).json()).toEqual({ user: "sam" });
		// and stays signed in
		expect(await (await ross.fetch(whoami)).json()).toEqual({ user: "ross" });
	});

	test("reads a page as a browser does", async () => {
		const { app, page } = setup();
		const res = await new Tester({ app }).fetch(page);

		expect(res.headers.get("content-type")).toContain("text/html");
		expect(await res.text()).toContain("<h1>Hello</h1>");
	});

	test("sends a form's fields as the form does", async () => {
		const { app, create, got } = setup();
		const ross = new Tester({ app, user: "ross" });
		const res = await ross.fetch(create, {
			data: {
				title: "Chili",
				servings: 4,
				vegan: true,
				steps: ["Brown the turkey", "Simmer"],
				ingredients: [{ name: "turkey", amount: "1 lb" }, { name: "beans" }],
				photo: new File(["pixels"], "chili.jpg", { type: "image/jpeg" }),
			},
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/recipes/1");
		expect(got.data).toEqual({
			title: "Chili",
			servings: 4,
			vegan: true,
			steps: ["Brown the turkey", "Simmer"],
			ingredients: [{ name: "turkey", amount: "1 lb" }, { name: "beans" }],
		});
		expect(got.file).toBe("chili.jpg image/jpeg pixels");
	});

	test("a box left clear and a field left out send nothing", async () => {
		const { app, create, got } = setup();
		const ross = new Tester({ app, user: "ross" });
		await ross.fetch(create, { data: { title: "Chili", vegan: false } });

		expect(got.data).toEqual({ title: "Chili", vegan: false });
	});

	test("a refused submission redirects with the form's state", async () => {
		const { app, create, update } = setup();
		const ross = new Tester({ app, user: "ross" });
		const res = await ross.fetch(create, {
			data: { title: "", ingredients: [{ amount: "1 lb" }] },
			search: { _return: "/recipes/new" },
		});
		const location = res.headers.get("location")!;

		expect(res.status).toBe(303);
		expect(location.startsWith(`${origin}/recipes/new?_form=`)).toBe(true);

		const state = create.state(location);
		expect(state?.issues?.map((issue) => issue.path.join("."))).toEqual([
			"title",
			"ingredients.0.name",
		]);
		// another form's state is not this one's
		expect(update.state(location)).toBeUndefined();
	});

	test("a route's parameters and search are its URL's", async () => {
		const { app, update, file } = setup();
		const tester = new Tester({ app });
		const res = await tester.fetch(update, {
			params: { id: "7" },
			data: { title: "Chili" },
		});

		expect(await res.json()).toEqual({ id: "7", title: "Chili" });
		expect(
			await (await tester.fetch(file, { params: { "*": "a/b.txt" } })).text(),
		).toBe("a/b.txt");
	});

	test("a GET route's fields are sent in the search", async () => {
		const { app, search } = setup();
		const res = await new Tester({ app }).fetch(search, {
			data: { q: "chili", tags: ["a", "b"] },
		});

		expect(await res.json()).toEqual({
			url: "?q=chili&tags=a&tags=b",
			data: { q: "chili", tags: ["a", "b"] },
		});
	});

	test("a form without fields is still a same-origin submission", async () => {
		const { app, remove } = setup();
		const res = await new Tester({ app, user: "ross" }).fetch(remove, {
			params: { id: "7" },
		});

		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/recipes");
	});

	test("requests a path, such as a redirect's location", async () => {
		const { app } = setup();
		const ross = new Tester({ app, user: "ross" });

		expect(await (await ross.fetch("/whoami")).json()).toEqual({
			user: "ross",
		});
		await expect(ross.fetch("https://other.example/whoami")).rejects.toThrow(
			"is not a page of the app",
		);
	});

	test("keeps the cookies the app sets, by path, until it deletes them", async () => {
		const { app, cookies, forget, sent, whoami } = setup();
		const tester = new Tester({ app });

		await tester.fetch(cookies);
		expect(await (await tester.fetch(sent)).json()).toEqual({
			seen: "yes",
			scoped: null,
		});
		// a cookie is sent only within its path
		const { req } = await capture(app, () => tester.fetch(whoami));
		expect(req.headers.get("cookie")).toContain("scoped=yes");

		await tester.fetch(forget);
		expect(await (await tester.fetch(sent)).json()).toEqual({
			seen: null,
			scoped: null,
		});
	});

	test("works for an app without auth, which has nobody to sign in", async () => {
		const hello = Route.get("/hello").use((c) => c.text(c.url.origin));
		const app = new App().use(hello);

		expect(await (await new Tester({ app }).fetch(hello)).text()).toBe(
			"http://localhost",
		);
		await expect(
			new Tester({ app, user: "ross" }).fetch(hello),
		).rejects.toThrow("The app has no Auth to sign the user in");
	});

	test("field names, parameters, and a user without auth are checked", () => {
		const { app, create, update, whoami } = setup();
		const tester = new Tester({ app });

		if (false) {
			// @ts-expect-error not one of the route's fields
			void tester.fetch(create, { data: { name: "Chili" } });
			// @ts-expect-error the route's parameters are required
			void tester.fetch(update, { data: { title: "Chili" } });
			// @ts-expect-error the route has no fields
			void tester.fetch(whoami, { data: { title: "Chili" } });
			// @ts-expect-error not one of the tool's arguments
			void tester.call(update, { id: "1", name: "Chili" });
			// @ts-expect-error the tool's parameters are required
			void tester.call(update, { title: "Chili" });
		}

		expect(tester).toBeInstanceOf(Tester);
	});
});

describe("call", () => {
	test("calls a tool as the user's agent", async () => {
		const { app, whoami } = setup();
		const result = await new Tester({ app, user: "ross" }).call(whoami);

		expect(result.isError).toBe(false);
		expect(result.structuredContent).toEqual({ user: "ross" });
		expect(result.content).toEqual([{ type: "text", text: '{"user":"ross"}' }]);
	});

	test("reads a page as Markdown", async () => {
		const { app, page } = setup();
		const result = await new Tester({ app, user: "ross" }).call(page);

		expect(result.content).toEqual([{ type: "text", text: "# Hello\n" }]);
	});

	test("sends parameters and fields as arguments", async () => {
		const { app, create, update, file, got } = setup();
		const ross = new Tester({ app, user: "ross" });

		expect(
			(await ross.call(update, { id: "7", title: "Chili" })).structuredContent,
		).toEqual({ id: "7", title: "Chili" });
		expect((await ross.call(file, { wildcard: "a/b.txt" })).content).toEqual([
			{ type: "text", text: "a/b.txt" },
		]);

		const added = await ross.call(create, {
			title: "Chili",
			ingredients: [{ name: "turkey" }],
			photo: { name: "chili.txt", type: "text/plain", text: "pixels" },
		});
		expect(added).toEqual({
			// the page it went to is not one agents read, so its address is kept
			content: [{ type: "text", text: "Redirected" }],
			isError: false,
		});
		// an agent updates only what it sends
		expect(got.updates).toEqual(["ingredients", "photo", "title"]);
		expect(got.file).toBe("chili.txt text/plain pixels");
	});

	test("a refused call says which field is wrong", async () => {
		const { app, update } = setup();
		const result = await new Tester({ app, user: "ross" }).call(update, {
			id: "7",
			title: "",
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("title");
	});

	test("lists the agent, and disconnecting it refuses its next call", async () => {
		const { app, whoami, agents, disconnect } = setup();
		const ross = new Tester({ app, user: "ross" });

		expect(await (await ross.fetch(agents)).json()).toEqual([]);
		await ross.call(whoami);

		const [agent] = (await (await ross.fetch(agents)).json()) as Auth.Agent[];
		expect(agent).toMatchObject({ id: "https://tester.test", name: "Tester" });

		await ross.fetch(disconnect, { data: { client: agent!.id } });
		await expect(ross.call(whoami)).rejects.toThrow("Unauthorized");
	});

	test("is refused without a signed-in user", async () => {
		const { app, whoami } = setup();

		await expect(new Tester({ app }).call(whoami)).rejects.toThrow(
			"Unauthorized",
		);
	});

	test("needs a described route and an endpoint", async () => {
		const { app, remove } = setup();
		const hello = Route.get("/hello")
			.describe("Say hello")
			.use((c) => c.text("hello"));

		await expect(
			new Tester({ app, user: "ross" }).call(remove, { id: "7" }),
		).rejects.toThrow("has no tool");
		await expect(
			new Tester({ app: new App().use(hello) }).call(hello),
		).rejects.toThrow("no Mcp endpoint");
	});

	test("calls an app's tools without auth", async () => {
		const hello = Route.get("/hello")
			.describe("Say hello")
			.use((c) => c.text("hello"));
		const app = new App().use(new Mcp({ path: "/agents" }), hello);

		expect((await new Tester({ app }).call(hello)).content).toEqual([
			{ type: "text", text: "hello" },
		]);
	});
});

describe("route.state", () => {
	test("is undefined for a URL without the form's state", () => {
		const { create } = setup();

		expect(create.state("/recipes/new")).toBeUndefined();
		expect(
			create.state(new URL("/recipes/new?_form=nonsense", origin)),
		).toBeUndefined();
	});

	test("holds the issues and the values kept", async () => {
		const { app, create } = setup();
		const res = await new Tester({ app, user: "ross" }).fetch(create, {
			data: { title: "Chili", servings: "many" },
		});
		const state = create.state(new URL(res.headers.get("location")!, origin));

		expect(state?.values).toEqual({ title: "Chili" });
		expect(state?.issues?.map((issue) => issue.path.join("."))).toEqual([
			"servings",
		]);
	});
});

/**
 * @param app App to watch
 * @param run Makes one request
 * @returns The request the app received
 */
async function capture(app: App, run: () => Promise<Response>) {
	let req!: Request;
	const { fetch } = app;
	const watch = (async (resource: Request) => {
		req = resource;
		return fetch(resource);
	}) as App["fetch"];
	Object.defineProperty(app, "fetch", { value: watch, configurable: true });
	try {
		await run();
	} finally {
		Object.defineProperty(app, "fetch", { value: fetch });
	}
	return { req };
}
