import * as formContent from "@/server/demo/form/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import * as ovr from "ovr";
import * as z from "zod";

export const form = ovr.Route.get("/demo/form", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...formContent.frontmatter} />}>
			<h1>{formContent.frontmatter.title}</h1>

			{ovr.Chunk.safe(formContent.html)}

			<hr />

			<post.Form class="bg-muted border-secondary grid max-w-sm gap-4 rounded-md border p-4">
				<div>
					<label for="file">File</label>
					<input type="file" name="file" id="file" />
				</div>

				<button>Submit</button>
			</post.Form>
		</Layout>
	);
});

export const post = ovr.Route.post(async (c) => {
	for await (const part of c.data()) {
		if (part.name === "file") {
			const stream = Writable.toWeb(
				createWriteStream(`${process.cwd()}/output.png`),
			);

			await part.body?.pipeTo(stream);
		}
	}

	console.log("done");

	c.redirect(form.pathname(), 303);
});
