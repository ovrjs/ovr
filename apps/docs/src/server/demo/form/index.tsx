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

			{ovr.Chunk.safe(formContent.html)}

			<hr />

			<post.Form class="bg-muted border-secondary grid max-w-sm gap-4 rounded-md border p-4">
				<div>
					<label for="photo">Photo</label>
					<input type="file" name="photo" id="photo" />
				</div>

				<button>Submit</button>
			</post.Form>
		</Layout>
	);
});

export const post = ovr.Route.post(async (c) => {
	try {
		for await (const part of c.data()) {
			if (part.name === "photo") {
				// NODE
				// await part.body.pipeTo(
				// 	Writable.toWeb(createWriteStream(`${process.cwd()}/output.png`)),
				// );
				// DENO
				// await Deno.writeFile("output.txt", part.body);
				// BUN
				// this should work but doesn't!
				// https://github.com/oven-sh/bun/issues/21455
				// await Bun.write(`${process.cwd()}/output.txt`, part);
			}
		}

		c.text("Upload Successful", 201);
	} catch (error) {
		console.error(error);
		c.text("Upload Failed", 500);
	}
});
