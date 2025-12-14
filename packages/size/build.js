import fs from "node:fs/promises";
import { build } from "rolldown";

const result = await build({ input: "entry.js", output: { minify: true } });

const bytes = result.output[0].code.length;

const kb = Math.round(bytes / 10) / 100;

console.log({ bytes, kb });

await fs.writeFile(
	"src/index.js",
	`export const bytes = ${bytes};\nexport const kb = ${kb};\n`,
);
