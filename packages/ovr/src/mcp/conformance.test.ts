import { App } from "../app/index.js";
import { Field } from "../form/index.js";
import { jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Mcp } from "./index.js";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/** The MCP revision the endpoint is held to */
const revision = "2026-07-28";

/** A small app like any other: pages, a form, and a file */
const app = new App().use(
	Route.get("/")
		.describe("Home page")
		.use(() =>
			jsx("main", {
				children: [
					jsx("h1", { children: "Notes" }),
					jsx("a", { href: "/notes/1", children: "Note 1" }),
				],
			}),
		),
	Route.get("/notes/:id")
		.describe("Read a note")
		.use((c) => jsx("main", { children: `Note ${c.params.id}` })),
	Route.post("/notes")
		.describe("Write a note")
		.fields({ text: Field.text(), stars: Field.number().optional() })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return;
			c.text(`Saved ${result.data.text}`);
		}),
	Route.get("/pixel.png")
		.describe("An image")
		.use((c) => {
			c.res.headers.set("content-type", "image/png");
			c.res.body = Uint8Array.fromBase64(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			);
		}),
	new Mcp({ name: "conformance" }),
);

/** @returns The app on a local port, as a Node server runs it */
const serve = () =>
	new Promise<{ url: string; close: () => void }>((resolve) => {
		const server = createServer(async (req, res) => {
			const headers = new Headers();
			for (const [name, value] of Object.entries(req.headers))
				if (value !== undefined) headers.set(name, String(value));

			const response = await app.fetch(
				new Request(`http://${req.headers.host}${req.url}`, {
					method: req.method!,
					headers,
					body:
						req.method === "GET" || req.method === "HEAD"
							? null
							: (Readable.toWeb(req) as ReadableStream),
					duplex: "half",
				} as RequestInit),
				// the client's address, which the endpoint's DNS rebinding check uses
				{ ip: req.socket.remoteAddress },
			);

			res.writeHead(response.status, [...response.headers]);
			if (response.body)
				for await (const chunk of response.body) res.write(chunk);
			res.end();
		}).listen(0, "127.0.0.1", () =>
			resolve({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
				close: () => server.close(),
			}),
		);
	});

test(
	`the MCP endpoint passes what the ${revision} conformance requirements can test`,
	{ timeout: 180_000 },
	async () => {
		// the suite is a command, found beside its package file
		const suite = join(
			dirname(
				createRequire(import.meta.url).resolve(
					"@modelcontextprotocol/conformance/package.json",
				),
			),
			"dist/index.js",
		);
		const here = dirname(fileURLToPath(import.meta.url));
		const results = await mkdtemp(join(tmpdir(), "conformance-"));
		const server = await serve();

		try {
			const run = spawn(
				process.execPath,
				[
					suite,
					"server",
					"--url",
					server.url,
					"--requirements",
					revision,
					// each known failure, with its reason
					"--expected-failures",
					join(here, "conformance.yml"),
					"--output-dir",
					results,
				],
				{ stdio: ["ignore", "pipe", "pipe"] },
			);

			let output = "";
			run.stdout.on("data", (chunk) => (output += chunk));
			run.stderr.on("data", (chunk) => (output += chunk));
			const code = await new Promise<number | null>((resolve) =>
				run.on("close", resolve),
			);

			// the suite's own summary says which check, when one fails
			expect(code, output.slice(output.lastIndexOf("=== SUMMARY"))).toBe(0);
		} finally {
			server.close();
			await rm(results, { recursive: true, force: true });
		}
	},
);
