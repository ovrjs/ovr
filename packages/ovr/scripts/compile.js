import { minifySync, transformSync } from "rolldown/utils";

/**
 * @param {string} source TypeScript browser module
 * @returns Minified JavaScript
 */
export const compile = (source) =>
	minifySync("client.js", transformSync("client.ts", source).code, {
		module: true,
	}).code;
