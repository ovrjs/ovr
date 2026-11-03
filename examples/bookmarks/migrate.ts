import { db, pool } from "./db.js";
import { readFile, readdir } from "node:fs/promises";

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
	// Auth's tables are listed in db.ts, so their migrations are applied first
	const applied = await db.migrate(files);
	const differences = await db.check();
	if (differences.length) throw new Error(differences.join("\n"));
	console.log({ applied });
} finally {
	await pool.end();
}
