import { auth } from "./auth.js";
import { db } from "./db.js";
import { App, Database, type JSX, Route } from "ovr";

const { bookmarks } = db;
const { title, url } = bookmarks.shape;

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

const login = Route.get("/login", async (c) => {
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

const create = Route.post("/bookmarks", { title, url }, async (c) => {
	const session = await auth.require(c);
	const result = await c.data();
	if (result.issues) return c.redirect(result.url, 303);

	const [bookmark] = await db.sql`
		INSERT INTO ${bookmarks}
		${db.sql.values(bookmarks, { ...result.data, owner: session.user })}
		ON CONFLICT (owner, url) DO NOTHING
		RETURNING *
	`.parse(bookmarks);

	if (!bookmark)
		return c.redirect(
			result.invalid({ url: "You already saved this URL" }).url,
			303,
		);

	return c.redirect(list, 303);
});

const update = Route.post("/bookmarks/:id", { title, url }, async (c) => {
	const session = await auth.require(c);
	if (bookmarks.shape.id.parse(c.params.id).issues)
		return c.text("Not Found", 404);

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
		if (Database.unique(error, "bookmarks_owner_url"))
			return c.redirect(
				result.invalid({ url: "You already saved this URL" }).url,
				303,
			);
		throw error;
	}

	return c.redirect(list, 303);
});

const remove = Route.post("/bookmarks/:id/delete", async (c) => {
	const session = await auth.require(c);
	if (bookmarks.shape.id.parse(c.params.id).issues)
		return c.text("Not Found", 404);

	const [bookmark] = await db.sql`
		DELETE FROM ${bookmarks}
		WHERE id = ${c.params.id} AND owner = ${session.user}
		RETURNING *
	`.parse(bookmarks);

	if (!bookmark) return c.text("Not Found", 404);
	return c.redirect(list, 303);
});

const list = Route.get("/bookmarks", async (c) => {
	const session = await auth.require(c);
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

const edit = Route.get("/bookmarks/:id/edit", async (c) => {
	const session = await auth.require(c);
	if (bookmarks.shape.id.parse(c.params.id).issues)
		return c.text("Not Found", 404);

	const [bookmark] = await db.sql`
		SELECT * FROM ${bookmarks}
		WHERE id = ${c.params.id} AND owner = ${session.user}
	`.parse(bookmarks);

	if (!bookmark) return c.text("Not Found", 404);

	return (
		<Page title="Edit bookmark">
			<update.Form
				params={c.params}
				values={bookmark}
				state={c.url}
				submit="Save changes"
			/>
			<list.Anchor>Back to bookmarks</list.Anchor>
		</Page>
	);
});

/** Mounts passkey endpoints and the application's CRUD routes. */
export const app = new App({ auth, form: { payload: 128 * 1024 } });

app.use(
	(c, next) => {
		c.res.headers.set("Cache-Control", "no-store");
		c.res.headers.set("Referrer-Policy", "no-referrer");
		return next();
	},
	Route.get("/", (c) => c.redirect(list, 303)),
	login,
	list,
	edit,
	create,
	update,
	remove,
);
