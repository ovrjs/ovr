import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";

/** Load the pre-optimization source, sharing the unchanged built utilities. */
export function baseline(
	name: "render" | "jsx" | "multipart",
	imports: Record<string, string> = {},
	commit = "068d6608db7a02283e4be64f5bcfb313305db1bb",
) {
	let source = stripTypeScriptTypes(
		execFileSync(
			"git",
			["show", `${commit}:packages/ovr/src/${name}/index.ts`],
			{ encoding: "utf8" },
		),
	);
	source = source.replace(
		/from "(\.[^"]+)"/g,
		(_, path: string) =>
			`from "${imports[path] ?? new URL(path, new URL(`../../ovr/dist/${name}/index.js`, import.meta.url)).href}"`,
	);
	return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
