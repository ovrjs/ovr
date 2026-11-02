import { db } from "./db.js";
import { Auth } from "ovr";

if (!process.env.AUTH_SECRET || !process.env.AUTH_ORIGIN)
	throw new Error("Set AUTH_SECRET and AUTH_ORIGIN");

/** Passkey registration creates the account and first credential atomically. */
export const auth = new Auth({
	secret: process.env.AUTH_SECRET,
	origin: process.env.AUTH_ORIGIN,
	page: "/login",
	redirect: "/bookmarks",
	database: db,
	register: {
		fields: { email: db.users.shape.email },
		name: ({ email }) => email,
		create: async (t, { email }, id) => {
			await t.sql`
				INSERT INTO ${db.users} ${t.sql.values(db.users, { id, email })}
			`;
		},
	},
	limits: {
		extra: [
			{
				name: `bookmarks:auth:${process.env.AUTH_ORIGIN}`,
				key: () => "all",
				limit: 100,
				interval: 60_000,
			},
		],
	},
});
