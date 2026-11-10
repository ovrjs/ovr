/**
 * What `c.data()` and `c.form()` hold at once for a large multipart body.
 *
 * node --expose-gc packages/bench/src/memory/multipart.ts
 *
 * `OVR_DIST=/path/to/dist` measures another build, see `ovr.ts`.
 */
import { type Peak, mb, scenario } from "./measure.ts";
import { ovr } from "./ovr.ts";

const { App, Field, Route } = ovr;

const size = 10 * 1024 * 1024;
const boundary = "memory-boundary";
const chunk = 64 * 1024;

/**
 * @param peak Sampled every 16 chunks the server reads
 * @returns A request with a `size` byte file, sent in 64 KiB chunks
 */
const upload = (peak: Peak) => {
	const encoder = new TextEncoder();
	const head = encoder.encode(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
	);
	const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
	let sent = -1;
	const body = new ReadableStream<Uint8Array>({
		pull(c) {
			if (sent === -1) {
				c.enqueue(head);
				sent = 0;
			} else if (sent < size) {
				c.enqueue(new Uint8Array(Math.min(chunk, size - sent)).fill(120));
				sent += chunk;
				if ((sent / chunk) % 16 === 0) peak.sample();
			} else {
				c.enqueue(tail);
				c.close();
			}
		},
	});
	return new Request("http://localhost/upload", {
		method: "POST",
		headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
		body,
		duplex: "half",
	} as RequestInit);
};

const app = (peak: () => Peak) =>
	new App({ form: { payload: 64 * 1024 * 1024 } }).use(
		Route.post("/upload")
			.fields({ file: Field.file() })
			.use(async (c) => {
				const result = await c.data();
				// what the handler holds once the form is parsed
				peak().sample();
				return c.text(String(result.issues ? 0 : result.data.file.size));
			}),
		Route.post("/stream").use(async (c) => {
			let bytes = 0;
			for await (const part of c.form())
				for await (const value of part.body) bytes += value.length;
			return c.text(String(bytes));
		}),
	);

let current: Peak;
const server = app(() => current);

await scenario(`c.data() with a ${mb(size)} MB file field`, async (peak) => {
	current = peak;
	const res = await server.fetch(upload(peak));
	return res.text();
});

await scenario(`c.form() streaming a ${mb(size)} MB file`, async (peak) => {
	current = peak;
	const req = upload(peak);
	const res = await server.fetch(
		new Request("http://localhost/stream", {
			method: "POST",
			headers: req.headers,
			body: req.body,
			duplex: "half",
		} as RequestInit),
	);
	return res.text();
});
