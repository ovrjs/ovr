import { App } from "../app/index.js";
import { Field } from "../form/index.js";
import { jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Mcp } from "./index.js";
import {
	Client as Current,
	StreamableHTTPClientTransport as CurrentTransport,
} from "@modelcontextprotocol/client";
import { Client as Earlier } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as EarlierTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
	Route.get("/report.pdf")
		.describe("A report")
		.use((c) => {
			c.res.headers.set("content-type", "application/pdf");
			c.res.body = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 0, 255]);
		}),
	Route.post("/files")
		.describe("Upload a file")
		.fields({ file: Field.file() })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return;
			const { file } = result.data;
			c.text(`${file.name} ${file.size} ${await file.text()}`);
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

// the current revision, and the earlier one clients such as ChatGPT's still use
test.each(["2026-07-28", "2025-11-25"])(
	"the MCP endpoint passes what the %s conformance requirements can test",
	{ timeout: 180_000 },
	async (revision) => {
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
					join(here, `conformance.${revision}.yml`),
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

/**
 * The official client libraries, which most agents are built on, read each
 * result with the protocol's own schemas, so a tool or resource result they
 * accept is one a real client can use.
 */
test.each([
	["the current", "2026-07-28", Current, CurrentTransport],
	["the earlier", "2025-11-25", Earlier, EarlierTransport],
] as const)(
	"%s official client lists, calls, and reads through the endpoint",
	async (_, version, Client, Transport) => {
		const server = await serve();
		const client = new Client({ name: "official-client", version: "1.0.0" });

		try {
			await client.connect(new Transport(new URL(server.url)) as never);

			const { tools } = await client.listTools();
			expect(tools.map((tool) => tool.name)).toEqual([
				"get_index",
				"get_notes_id",
				"post_notes",
				expect.stringMatching(/^get_pixel_png_/),
				expect.stringMatching(/^get_report_pdf_/),
				"post_files",
			]);
			const [, , , pixel, report] = tools;

			const call = async (name: string, args: Record<string, unknown> = {}) =>
				(await client.callTool({ name, arguments: args })) as {
					content: Record<string, any>[];
					isError?: boolean;
				};

			// a page, as Markdown
			expect((await call("get_notes_id", { id: "7" })).content).toEqual([
				{ type: "text", text: "Note 7\n" },
			]);

			// a form, and its issues as an error the model reads
			expect(
				(await call("post_notes", { text: "Hi", stars: 3 })).content,
			).toEqual([{ type: "text", text: "Saved Hi" }]);
			const invalid = await call("post_notes", {});
			expect(invalid.isError).toBe(true);
			expect(invalid.content[0]!.text).toContain("Required field");

			// a file sent, and files received: an image, and any other as a resource
			expect(
				(
					await call("post_files", {
						file: { name: "a.txt", type: "text/plain", text: "hello" },
					})
				).content[0]!.text,
			).toBe("a.txt 5 hello");
			expect((await call(pixel!.name)).content).toEqual([
				{ type: "image", mimeType: "image/png", data: expect.any(String) },
			]);
			const pdf = (await call(report!.name)).content;
			expect(pdf).toEqual([
				{
					type: "resource",
					resource: {
						uri: expect.stringMatching(/\/report\.pdf$/),
						mimeType: "application/pdf",
						blob: "JVBERi0xLjcA/w==",
					},
				},
			]);

			// pages as resources
			const origin = new URL(server.url).origin;
			const { resources } = await client.listResources();
			expect(resources.map((resource) => resource.uri)).toEqual([
				`${origin}/`,
				`${origin}/pixel.png`,
				`${origin}/report.pdf`,
			]);
			expect(
				(await client.listResourceTemplates()).resourceTemplates[0]!
					.uriTemplate,
			).toBe(`${origin}/notes/{id}`);
			expect(
				(await client.readResource({ uri: `${origin}/notes/3` })).contents,
			).toEqual([
				{
					uri: `${origin}/notes/3`,
					mimeType: "text/markdown",
					text: "Note 3\n",
				},
			]);
			expect(
				(await client.readResource({ uri: `${origin}/report.pdf` })).contents,
			).toEqual([
				{
					uri: `${origin}/report.pdf`,
					mimeType: "application/pdf",
					blob: "JVBERi0xLjcA/w==",
				},
			]);
			await expect(
				client.readResource({ uri: `${origin}/missing` }),
			).rejects.toMatchObject({
				code: version === "2026-07-28" ? -32602 : -32002,
			});
		} finally {
			await client.close();
			server.close();
		}
	},
);
