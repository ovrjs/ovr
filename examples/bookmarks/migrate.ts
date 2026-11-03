import { db, pool } from "./db.js";
import { readFile, readdir } from "node:fs/promises";
import { Auth } from "ovr";

try {
	const directory = new URL("./migrations/", import.meta.url);
	const files = await Promise.all(
		(await readdir(directory))
			.filter((file) => file.endsWith(".sql"))
			.map(async (id) => ({
				id,
				sql: await readFile(new URL(id, directory), "utf8"),
			})),
	);
	// ovr's Auth tables, a fixed version applied in this app's order
	const applied = await db.migrate([
		...files,
		{ id: "0002_auth", sql: Auth.sql[1] },
		{ id: "0004_auth_agents", sql: Auth.sql[2] },
	]);
	const differences = await db.check();
	if (differences.length) throw new Error(differences.join("\n"));
	console.log({ applied });
} finally {
	await pool.end();
}
