import { auth } from "./auth.js";
import { db } from "./db.js";
import { App, Database, type JSX, Mcp, Route } from "ovr";

const { bookmarks } = db;
const { id, title, url } = bookmarks.shape;

/** Short, public values, so these forms refill them after an error */
const editable = { title: title.persist(), url: url.persist() };

/** Shared document shell. Resolve authentication and data before rendering. */
function Page({ title, children }: { title: string; children: JSX.Element }) {
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{title}</title>
			</head>
			<body>
				<main>
					<h1>{title}</h1>
					{children}
				</main>
			</body>
		</html>
	);
}

const login = Route.get("/login")
	.describe(false)
	.use(async (c) => {
		if (await auth.session(c)) return c.redirect(list, 303);
		const { Register, Login } = auth.forms(c);

		return (
			<Page title="Your bookmarks">
				<h2>Log in</h2>
				<Login />
				<h2>Create account</h2>
				<Register />
			</Page>
		);
	});

const create = Route.post("/bookmarks")
	.describe("Save a bookmark")
	.fields(editable)
	.use(async (c) => {
		const session = await auth.session(c);
		if (!session) return c.redirect(login, 303);
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		const [bookmark] = await db.sql`
			INSERT INTO ${bookmarks}
			${db.sql.values(bookmarks, { ...result.data, owner: session.user })}
			ON CONFLICT (owner, url) DO NOTHING
			RETURNING *
		`.parse(bookmarks);

		if (!bookmark) {
			const invalid = result.invalid({ url: "You already saved this URL" });
			return c.redirect(invalid.url, 303);
		}

		return c.redirect(list, 303);
	});

const update = Route.post("/bookmarks/:id")
	.describe("Change a bookmark's title or URL")
	.params({ id })
	.fields(editable)
	.use(async (c) => {
		const session = await auth.session(c);
		if (!session) return c.redirect(login, 303);
		const result = await c.data();
		if (result.issues) return c.redirect(result.url, 303);

		try {
			const [bookmark] = await db.sql`
				UPDATE ${bookmarks} SET ${db.sql.set(bookmarks, result.data)}
				WHERE id = ${c.params.id} AND owner = ${session.user}
				RETURNING *
			`.parse(bookmarks);

			if (!bookmark) return c.text("Not Found", 404);
		} catch (error) {
			// Match the specific constraint, not every database failure.
			if (Database.unique(error, "bookmarks_owner_url")) {
				const invalid = result.invalid({ url: "You already saved this URL" });
				return c.redirect(invalid.url, 303);
			}
			throw error;
		}

		return c.redirect(list, 303);
	});

const remove = Route.post("/bookmarks/:id/delete")
	.describe("Delete a bookmark", { destructive: true })
	.params({ id })
	.use(async (c) => {
		const session = await auth.session(c);
		if (!session) return c.redirect(login, 303);
		const [bookmark] = await db.sql`
			DELETE FROM ${bookmarks}
			WHERE id = ${c.params.id} AND owner = ${session.user}
			RETURNING *
		`.parse(bookmarks);

		if (!bookmark) return c.text("Not Found", 404);
		return c.redirect(list, 303);
	});

const list = Route.get("/bookmarks")
	.describe("The latest 50 bookmarks")
	.use(async (c) => {
		const session = await auth.session(c);
		if (!session) return c.redirect(login, 303);
		const { Logout } = auth.forms(c);
		const rows = await db.sql`
			SELECT * FROM ${bookmarks} WHERE owner = ${session.user}
			ORDER BY created DESC, id DESC LIMIT 50
		`.parse(bookmarks);

		return (
			<Page title="Your bookmarks">
				<Logout />
				<h2>Add a bookmark</h2>
				<create.Form state={c.url} submit="Add bookmark" />
				<h2>Latest 50 bookmarks</h2>
				{rows.length ? (
					<ul>
						{rows.map((bookmark) => (
							<li>
								<a href={bookmark.url}>{bookmark.title}</a>{" "}
								<edit.Anchor params={{ id: bookmark.id }}>Edit</edit.Anchor>
								<remove.Form params={{ id: bookmark.id }}>
									<button>Delete {bookmark.title}</button>
								</remove.Form>
							</li>
						))}
					</ul>
				) : (
					<p>No bookmarks yet.</p>
				)}
			</Page>
		);
	});

const edit = Route.get("/bookmarks/:id/edit")
	.describe("A bookmark with its edit form")
	.params({ id })
	.use(async (c) => {
		const session = await auth.session(c);
		if (!session) return c.redirect(login, 303);
		const [bookmark] = await db.sql`
			SELECT * FROM ${bookmarks}
			WHERE id = ${c.params.id} AND owner = ${session.user}
		`.parse(bookmarks);

		if (!bookmark) return c.text("Not Found", 404);

		return (
			<Page title="Edit bookmark">
				<update.Form
					params={{ id: bookmark.id }}
					values={bookmark}
					state={c.url}
					submit="Save changes"
				/>
				<list.Anchor>Back to bookmarks</list.Anchor>
			</Page>
		);
	});

const connect = Route.get("/connect")
	.describe(false)
	.use(async (c) => {
		if (!(await auth.session(c))) return c.redirect(login, 303);
		const request = await auth.consent(c);
		if (!request) return c.text("This request expired. Connect again.", 400);

		return (
			<Page title={`Connect ${request.client.name}?`}>
				<p>
					{request.client.name} will be able to read and change your bookmarks.
					You will return to {request.redirect}.
				</p>
				<request.Form />
			</Page>
		);
	});

/** Agents use the described routes as tools, and read pages as Markdown. */
const mcp = new Mcp({
	name: "bookmarks",
	instructions: "Save, edit, and delete the user's bookmarks.",
	auth,
});

/** Mounts passkey endpoints, the MCP endpoint, and the application's CRUD routes. */
export const app = new App({ form: { payload: 128 * 1024 } });

app.use(
	(c, next) => {
		c.res.headers.set("Cache-Control", "no-store");
		c.res.headers.set("Referrer-Policy", "no-referrer");
		return next();
	},
	auth,
	mcp,
	Route.get("/").use((c) => c.redirect(list, 303)),
	login,
	connect,
	list,
	edit,
	create,
	update,
	remove,
);
