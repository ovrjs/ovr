import { FrontmatterSchema, options } from "./src/lib/md/index.ts";
import { adapter } from "@domcojs/vercel";
import { md } from "@robino/md";
import tailwindcss from "@tailwindcss/vite";
import { domco } from "domco";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { imagetools } from "vite-imagetools";

export default defineConfig({
	build: { minify: true },
	server: {
		strictPort: true,
		...(existsSync(".auth-cert.pem") && {
			https: {
				key: readFileSync(".auth-key.pem"),
				cert: readFileSync(".auth-cert.pem"),
			},
		}),
	},
	plugins: [
		tailwindcss(),
		domco({ adapter: adapter({ config: { runtime: "nodejs26.x" } }) }),
		md({ ...options, FrontmatterSchema }),
		imagetools(),
	],
});
