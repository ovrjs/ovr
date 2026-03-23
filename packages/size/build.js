import fs from "node:fs/promises";
import path from "node:path";
import { build } from "rolldown";

/** @typedef {{ bytes: number, kb: number }} Size */

/**
 * @param {number} bytes
 */
const round = (bytes) => Math.round(bytes / 10) / 100;

/**
 * @param {import("rolldown").InputOption} input
 */
const getSize = async (input) => {
	const result = await build({ input, output: { minify: true } });
	const bytes = result.output[0].code.length;

	return { bytes, kb: round(bytes) };
};

/**
 * @param {Size} param0
 */
const format = ({ bytes, kb }) => `{ bytes: ${bytes}, kb: ${kb} }`;

/**
 * @param {string} value
 */
const isName = (value) =>
	/^[A-Za-z_$][\w$]*$/u.test(value) && value !== "default";

const temp = await fs.mkdtemp(path.join(process.cwd(), ".size-"));

try {
	const size = await getSize("entry.js");
	const names = Object.keys(await import("ovr")).sort();
	/** @type {[string, Size][]} */
	const list = [];

	for (const name of names) {
		const file = path.join(temp, `${name}.js`);

		await fs.writeFile(file, `export { ${name} } from "ovr";\n`);

		list.push([name, await getSize(file)]);
	}

	const named = list.filter(([name]) => isName(name));
	const quoted = list.filter(([name]) => !isName(name));
	const source = [
		`export const bytes = ${size.bytes};`,
		`export const kb = ${size.kb};`,
		"",
		...named.flatMap(([name, value]) => [
			`export const ${name} = ${format(value)} as const;`,
			"",
		]),
		"export const sizes = {",
		...named.map(([name]) => `\t${name},`),
		...quoted.map(
			([name, value]) => `\t[${JSON.stringify(name)}]: ${format(value)},`,
		),
		"} as const;",
		"",
	].join("\n");

	console.log({ bytes: size.bytes, kb: size.kb, exports: list.length });

	await fs.writeFile("src/index.ts", source);
} finally {
	await fs.rm(temp, { recursive: true, force: true });
}
