import { source } from "../src/auth/client-source.js";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { expect, test } from "vitest";

test("the generated asset exactly matches the type-checked browser source", async () => {
	expect(source).toBe(
		stripTypeScriptTypes(
			await readFile(new URL("../src/auth/client.ts", import.meta.url), "utf8"),
		),
	);
});
