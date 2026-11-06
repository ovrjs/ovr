import { etag, source } from "../src/auth/client-source.js";
import { compile } from "./compile.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("the generated asset exactly matches the minified browser source", async () => {
	expect(source).toBe(
		compile(
			await readFile(new URL("../src/auth/client.ts", import.meta.url), "utf8"),
		),
	);
	expect(etag).toBe(`W/"${createHash("sha256").update(source).digest("hex")}"`);
});
