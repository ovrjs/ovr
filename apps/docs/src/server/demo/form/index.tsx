import * as formContent from "@/server/demo/form/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
// import { createWriteStream } from "node:fs";
// import { Writable } from "node:stream";
import * as ovr from "ovr";

export const form = ovr.Route.get("/demo/form", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...formContent.frontmatter} />}>
			<h1>{formContent.frontmatter.title}</h1>

			{ovr.Render.html(formContent.html)}

			<hr />

			<post.Form class="bg-muted border-secondary grid max-w-sm gap-4 rounded-md border p-4">
				<div>
					<label for="name">Name</label>
					<input type="text" name="name" id="name" />
				</div>

				<button>Submit</button>
			</post.Form>
		</Layout>
	);
});

export const post = ovr.Route.post(async (c) => {
	for await (const part of c.form()) {
		if (part.name === "name") {
			console.log(part);
			// NODE
			// await part.body.pipeTo(
			// 	Writable.toWeb(createWriteStream(`${process.cwd()}/output.png`)),
			// );
			//
			// DENO
			// await Deno.writeFile("output.txt", part.body);
			//
			// BUN
			// this should work but doesn't!
			// https://github.com/oven-sh/bun/issues/21455
			// await Bun.write(`${process.cwd()}/output.txt`, part);
		}
	}

	c.redirect("/", 303);
});
