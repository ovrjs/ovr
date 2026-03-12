import * as formContent from "@/server/demo/form/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Field, Render, Route } from "ovr";

export const enroll = Route.post(
	{
		name: Field.text({ placeholder: "Harry Potter" })
			.min(2, "Expected at least 2 characters")
			.persist(),
		email: Field.email({ placeholder: "name@hogwarts.edu" }).refine(
			(v) => v.endsWith("@hogwarts.edu"),
			"Expected a @hogwarts.edu email",
		),
		house: Field.select([
			"Gryffindor",
			"Hufflepuff",
			"Ravenclaw",
			"Slytherin",
		]).persist(),
		wand: Field.radio([
			"Phoenix feather",
			"Dragon heartstring",
			"Unicorn hair",
		]).persist(),
		year: Field.number().min(1).max(7).persist(),
		pet: Field.checkboxes(["Owl", "Cat", "Toad"]).persist(),
		arrival: Field.date().persist(),
		rules: Field.checkbox()
			.refine((v) => v, "You must accept the castle rules")
			.persist(),
		license: Field.file().stream(), // put `.stream()` last to parse fields first
	},
	async (c) => {
		const result = await c.data();

		if (result.issues) return c.redirect(result.url, 303);

		if (result.stream) {
			for await (const _part of result.stream) {
				// console.log(part);
				// await part.bytes();
			}
		}

		// create new student record...

		c.redirect(form, 303);
	},
);

export const form = Route.get("/demo/form", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...formContent.frontmatter} />}>
			<h1>{formContent.frontmatter.title}</h1>

			{Render.html(formContent.html)}

			<enroll.Form state={c.url} />
		</Layout>
	);
});
