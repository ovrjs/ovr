/**
 * What an MCP tool call holds at once: a file argument on its way in, and a
 * file response on its way out.
 *
 * node --expose-gc packages/bench/src/memory/mcp.ts
 *
 * `OVR_DIST=/path/to/dist` measures another build, see `ovr.ts`.
 */
import { type Peak, mb, scenario } from "./measure.ts";
import { ovr } from "./ovr.ts";

const { App, Field, Mcp, Route } = ovr;

const version = "2026-07-28";
const size = 3 * 1024 * 1024;
const meta = {
	"io.modelcontextprotocol/protocolVersion": version,
	"io.modelcontextprotocol/clientInfo": { name: "memory", version: "1" },
	"io.modelcontextprotocol/clientCapabilities": {},
};

let current: Peak | undefined;
const file = new Uint8Array(size).fill(7);

const upload = Route.post("/upload")
	.describe("Upload a file")
	.fields({ file: Field.file() })
	.use(async (c) => {
		// the request the endpoint made, before the route reads it
		current?.sample();
		const result = await c.data();
		// the route has its own copy now
		current?.sample();
		return c.text(String(result.issues ? 0 : result.data.file.size));
	});

const download = Route.get("/download")
	.describe("Download a file")
	.use(() => {
		current?.sample();
		return new Response(file, {
			headers: { "content-type": "application/octet-stream" },
		});
	});

const app = new App({ form: { memory: 16 * 1024 * 1024 } }).use(
	new Mcp(),
	upload,
	download,
);

/**
 * @param name Tool
 * @param args Arguments
 * @returns The JSON-RPC request, its body streamed in 64 KiB chunks as a
 * server reads it, so nothing outside the endpoint holds the whole body
 */
const call = (name: string, args: Record<string, unknown>) => {
	let json: string | undefined = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name, arguments: args, _meta: meta },
	});
	let at = 0;
	const encoder = new TextEncoder();
	return new Request("http://localhost/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"mcp-protocol-version": version,
			"mcp-method": "tools/call",
			"mcp-name": name,
		},
		body: new ReadableStream<Uint8Array>({
			pull(c) {
				if (json === undefined || at >= json.length) {
					json = undefined;
					return c.close();
				}
				c.enqueue(encoder.encode(json.slice(at, (at += 65536))));
			},
		}),
		duplex: "half",
	} as RequestInit);
};

let base64: string | undefined;

await scenario(
	`tools/call with a ${mb(size)} MB file argument (${mb((size * 4) / 3)} MB base64), live set inside the route`,
	async (peak) => {
		base64 = file.toBase64();
		const req = call(upload.tool!.name, {
			file: { name: "a.bin", type: "application/octet-stream", base64 },
		});
		// only the stream's copy is left, as a client would send it
		base64 = undefined;
		current = peak;
		const res = await app.fetch(req);
		current = undefined;
		const text = await res.text();
		if (!text.includes(String(size))) throw new Error(text.slice(0, 200));
	},
);

// the endpoint parses the body with JSON.parse: sampled as it returns, when
// the body is held as text, as the message, and as bytes unless let go
const parse = JSON.parse;
await scenario(
	`tools/call with a ${mb(size)} MB file argument, live set as the body is parsed`,
	async (peak) => {
		base64 = file.toBase64();
		const req = call(upload.tool!.name, {
			file: { name: "a.bin", type: "application/octet-stream", base64 },
		});
		base64 = undefined;
		JSON.parse = (text: string, reviver?: Parameters<typeof parse>[1]) => {
			const result = parse(text, reviver);
			if (text.length > 1024 * 1024) peak.sample();
			return result;
		};
		try {
			const res = await app.fetch(req);
			await res.text();
		} finally {
			JSON.parse = parse;
		}
	},
);

// the endpoint answers with JSON.stringify: sampled as it returns, when the
// file is held as base64 in the result and in the JSON-RPC body
const stringify = JSON.stringify;
await scenario(
	`tools/call answered with a ${mb(size)} MB file, live set as the answer is made, then until it is read`,
	async (peak) => {
		current = peak;
		JSON.stringify = ((...args: Parameters<typeof stringify>) => {
			const json = stringify(...args);
			if (json.length > 1024 * 1024) peak.sample();
			return json;
		}) as typeof stringify;
		try {
			const res = await app.fetch(call(download.tool!.name, {}));
			current = undefined;
			// the response, before it is sent
			peak.sample();
			const text = await res.text();
			if (!text.includes('"blob"')) throw new Error(text.slice(0, 200));
		} finally {
			JSON.stringify = stringify;
		}
	},
);
