// @ts-nocheck - TODO look into fixing the plugin types
import { FrontmatterSchema, options } from "./src/lib/md";
import { adapter } from "@domcojs/vercel";
import { md } from "@robino/md";
import tailwindcss from "@tailwindcss/vite";
import { domco } from "domco";
import { defineConfig } from "vite";
import { imagetools } from "vite-imagetools";

export default defineConfig({
	build: { minify: true },
	plugins: [
		tailwindcss(),
		domco({ adapter: adapter() }),
		md({ ...options, FrontmatterSchema }),
		imagetools(),
	],
});
