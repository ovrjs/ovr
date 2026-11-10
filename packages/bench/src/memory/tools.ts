/**
 * What one MCP tool call allocates in an app with many tools, and what many
 * routes with fields retain.
 *
 * node --expose-gc --max-semi-space-size=256 packages/bench/src/memory/tools.ts
 *
 * `OVR_DIST=/path/to/dist` measures another build, see `ovr.ts`.
 */
import { allocated, scenario } from "./measure.ts";
import { ovr } from "./ovr.ts";

const { App, Field, Mcp, Route } = ovr;

const count = 1000;
const version = "2026-07-28";

/**
 * @param i Index, so each pattern is its own
 * @returns A described POST route with five fields
 */
const route = (i: number) =>
	Route.post(`/items/${i}/:id`)
		.describe(`Change item ${i}`)
		.fields({
			title: Field.text().min(1).max(100),
			body: Field.textarea(),
			count: Field.number().min(0),
			email: Field.email(),
			done: Field.checkbox(),
		})
		.use((c) => c.text("ok"));

const routes = Array.from({ length: count }, (_, i) => route(i));
const app = new App().use(new Mcp(), routes);
const name = routes[0]!.tool!.name;

/** @returns The response text of one tools/call */
const call = () =>
	app
		.fetch("http://localhost/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"mcp-protocol-version": version,
				"mcp-method": "tools/call",
				"mcp-name": name,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name,
					arguments: {
						id: "1",
						title: "a",
						body: "b",
						count: 1,
						email: "a@b.co",
					},
					_meta: {
						"io.modelcontextprotocol/protocolVersion": version,
						"io.modelcontextprotocol/clientInfo": {
							name: "memory",
							version: "1",
						},
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
		})
		.then((res) => res.text());

// compiled before it is measured
for (let i = 0; i < 20; i++) await call();
await allocated(`one tools/call in an app with ${count} tools`, call);

for (let run = 0; run < 3; run++) {
	const time = performance.now();
	for (let i = 0; i < 200; i++) await call();
	console.log(
		`  ${((performance.now() - time) / 200).toFixed(3)} ms per call, mean of 200`,
	);
}

await scenario(
	`${count} POST routes with five fields, mounted`,
	async (peak) => {
		const routes = Array.from({ length: count }, (_, i) => route(i));
		const app = new App().use(routes);
		peak.sample();
		return [app, routes];
	},
);

await scenario(`${count} POST routes without fields, mounted`, async (peak) => {
	const routes = Array.from({ length: count }, (_, i) =>
		Route.post(`/items/${i}/:id`).use((c) => c.text("ok")),
	);
	const app = new App().use(routes);
	peak.sample();
	return [app, routes];
});
