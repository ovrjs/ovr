import { database } from "./database.js";
import { Auth } from "ovr";

if (!process.env.AUTH_SECRET || !process.env.AUTH_ORIGIN)
	throw new Error("Set AUTH_SECRET and AUTH_ORIGIN");

/** Passkey registration creates the account and first credential atomically. */
export const auth = new Auth({
	secret: process.env.AUTH_SECRET,
	origin: process.env.AUTH_ORIGIN,
	page: "/login",
	redirect: "/bookmarks",
	database,
	// registering inserts the email, the table's form field
	users: database.users,
});
