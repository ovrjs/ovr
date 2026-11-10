import path from "node:path";
import { build } from "rolldown";

/**
 * Prints what each source module contributes when one export of ovr is
 * bundled on its own, so it is clear which imports make an export large.
 *
 * Usage: node breakdown.js [Export ...]  (no names = the whole entry)
 *
 * "min" is attributed from the minified bundle's source map, so the column
 * adds up to the bundle's real minified size. "raw" is the module's rendered
 * length before minifying. Chunks split off by a dynamic `import()` are listed
 * separately: "static" chunks load with the entry, "lazy" ones on first use.
 */

const dist = path.resolve(import.meta.dirname, "../ovr/dist");

const chars =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodes the generated column and source index of every source map segment.
 *
 * @param {string} mappings
 */
const decode = (mappings) => {
	/** @type {{ line: number, column: number, source: number }[]} */
	const segments = [];
	let source = 0;

	mappings.split(";").forEach((line, index) => {
		let column = 0;

		for (const segment of line.split(",")) {
			if (!segment) continue;

			/** @type {number[]} */
			const values = [];
			let value = 0;
			let shift = 0;

			for (const char of segment) {
				const digit = chars.indexOf(char);
				value += (digit & 31) << shift;

				if (digit & 32) {
					shift += 5;
				} else {
					values.push(value & 1 ? -(value >>> 1) : value >>> 1);
					value = 0;
					shift = 0;
				}
			}

			column += values[0] ?? 0;
			if (values.length > 1) source += values[1] ?? 0;

			segments.push({
				line: index,
				column,
				source: values.length > 1 ? source : -1,
			});
		}
	});

	return segments;
};

/**
 * @param {string} code
 * @param {{ sources: string[], mappings: string }} map
 */
const attribute = (code, map) => {
	const lines = code.split("\n");
	const segments = decode(map.mappings);
	/** @type {Map<string, number>} */
	const bytes = new Map();
	let last = "(unmapped)";

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const next = segments[i + 1];

		if (!segment) continue;

		const end =
			next && next.line === segment.line
				? next.column
				: (lines[segment.line]?.length ?? 0) + 1;

		if (segment.source >= 0) last = map.sources[segment.source] ?? last;

		bytes.set(last, (bytes.get(last) ?? 0) + end - segment.column);
	}

	return bytes;
};

/** @param {string} id */
const name = (id) => {
	const file = path.resolve(id);

	return file.startsWith(dist) ? path.relative(dist, file) : id;
};

/** @param {string | undefined} exported */
const breakdown = async (exported) => {
	const input = exported ? `virtual:${exported}` : "virtual:entry";
	const source = exported
		? `export { ${exported} } from "ovr";`
		: `export * from "ovr";`;
	/** @type {import("rolldown").Plugin} */
	const virtual = {
		name: "virtual",
		resolveId: (id) => (id === input ? id : null),
		load: (id) => (id === input ? source : null),
	};

	const [raw, min] = await Promise.all(
		[false, true].map((minify) =>
			build({
				input,
				cwd: import.meta.dirname,
				plugins: [virtual],
				write: false,
				output: { minify, sourcemap: true },
			}),
		),
	);

	/** @type {Map<string, number>} */
	const rendered = new Map();

	for (const chunk of raw?.output ?? []) {
		if (chunk.type !== "chunk") continue;

		for (const [id, module] of Object.entries(chunk.modules)) {
			rendered.set(name(id), module.renderedLength);
		}
	}

	console.log(`\n${exported ?? "everything"}`);

	const chunks = (min?.output ?? []).flatMap((chunk) =>
		chunk.type === "chunk" ? [chunk] : [],
	);
	// chunks the entry imports statically load with it, the rest on first use
	/** @type {Set<string>} */
	const loaded = new Set();
	/** @param {string} file */
	const load = (file) => {
		if (loaded.has(file)) return;
		loaded.add(file);
		for (const chunk of chunks)
			if (chunk.fileName === file) chunk.imports.forEach(load);
	};
	for (const chunk of chunks) if (chunk.isEntry) load(chunk.fileName);

	for (const chunk of chunks) {
		if (!chunk.map) continue;

		// Source map paths are relative to the output directory.
		const sources = chunk.map.sources.map((/** @type {string} */ id) =>
			name(path.resolve(import.meta.dirname, "dist", id)),
		);
		// Leave out the source map comment, which build.js does not emit.
		const code = chunk.code.replace(/\n\/\/# sourceMappingURL=.*\n?$/u, "");
		const bytes = attribute(code, { ...chunk.map, sources });
		const rows = [...bytes].sort((a, b) => b[1] - a[1]);

		console.log(
			`  ${chunk.isEntry ? "entry " : loaded.has(chunk.fileName) ? "static" : "lazy  "} chunk ${code.length} bytes`,
		);

		for (const [id, size] of rows) {
			console.log(
				`    ${String(size).padStart(7)}  ${String(rendered.get(id) ?? "").padStart(7)}  ${id}`,
			);
		}
	}
};

const names = process.argv.slice(2);

console.log("      min      raw  module");

for (const exported of names.length ? names : [undefined]) {
	await breakdown(exported);
}
