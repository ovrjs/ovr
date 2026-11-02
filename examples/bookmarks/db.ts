import { Auth, Database, Field, Schema, Table } from "ovr";
import { Pool } from "pg";

const users = new Table("users", {
	id: Schema.string().uuid(),
	email: Field.email({ label: "Email" }),
});

const bookmarks = new Table(
	"bookmarks",
	{
		id: Schema.string().uuid(),
		owner: Schema.string().uuid(),
		title: Field.text({ label: "Title" }).min(1).max(120).persist(),
		url: Field.url({ label: "URL" })
			.max(300)
			.refine(
				(value) => /^https?:\/\//i.test(value),
				"Use an HTTP or HTTPS URL",
			)
			.persist(),
		created: Schema.date(),
	},
	{ default: ["id", "created"] },
);

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");

/** Application-owned connection pool; close it during server shutdown. */
export const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	allowExitOnIdle: true,
});

/** Tables describe row validation; constraints and indexes live in SQL. */
export const db = new Database(pool, [users, bookmarks, ...Auth.tables]);
