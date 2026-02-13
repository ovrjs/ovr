import * as schemaContent from "@/server/demo/schema/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Render, Route, Schema } from "ovr";

export const create = Route.post(
	{
		name: Schema.Field.text({ placeholder: "Harry Potter" })
			.refine((v) => v.trim().length >= 2, "Expected at least 2 characters")
			.refine((v) => v.trim().length <= 40, "Expected at most 40 characters"),
		email: Schema.Field.email({ placeholder: "name@hogwarts.edu" }).refine(
			(v) => v.endsWith("@hogwarts.edu"),
			"Expected a @hogwarts.edu email",
		),
		house: Schema.Field.select([
			"Gryffindor",
			"Hufflepuff",
			"Ravenclaw",
			"Slytherin",
		]),
		wand: Schema.Field.radio([
			"Phoenix feather",
			"Dragon heartstring",
			"Unicorn hair",
		]),
		year: Schema.Field.number({ min: 1, max: 7 }).refine(
			(v) => v >= 1 && v <= 7,
			"Expected a year between 1 and 7",
		),
		pet: Schema.Field.checkboxes(["Owl", "Cat", "Toad"]).optional(),
		arrival: Schema.Field.date(),
		terms: Schema.Field.checkbox().refine(
			(v) => v,
			"You must accept the castle rules",
		),
	},
	async (c) => {
		const result = await c.data();

		if (result.issues) {
			return c.redirect(result.state, 303);
		}

		console.log(result.data);

		return c.redirect(schema, 303);
	},
);

export const schema = Route.get("/demo/schema", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...schemaContent.frontmatter} />}>
			<h1>{schemaContent.frontmatter.title}</h1>

			{Render.html(schemaContent.html)}

			<create.Form
				state={c.url}
				class="bg-muted border-secondary grid gap-4 rounded-md border p-4 **:data-issue:mt-1 **:data-issue:text-sm **:data-issue:italic sm:max-w-sm [&_label,&_legend]:capitalize"
			/>
		</Layout>
	);
});
