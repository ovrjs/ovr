import * as formContent from "@/server/demo/form/index.md";
import { Layout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Field, Render, Route } from "ovr";

export const enroll = Route.post("/demo/form")
	.fields({
		name: Field.text()
			.control({ placeholder: "Harry Potter" })
			.min(2, "Expected at least 2 characters"),
		email: Field.email()
			.control({ placeholder: "name@hogwarts.edu" })
			.refine(
				(v) => v.endsWith("@hogwarts.edu"),
				"Expected a @hogwarts.edu email",
			),
		house: Field.select(["Gryffindor", "Hufflepuff", "Ravenclaw", "Slytherin"]),
		wand: Field.radio([
			"Phoenix feather",
			"Dragon heartstring",
			"Unicorn hair",
		]),
		year: Field.number().min(1).max(7),
		pet: Field.checkboxes(["Owl", "Cat", "Toad"]).optional(),
		arrival: Field.date(),
		rules: Field.checkbox().refine(
			(v) => v,
			"You must accept the castle rules",
		),
		license: Field.file().stream(), // put `.stream()` last to parse fields first
	})
	.use(async (c) => {
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
	});

export const form = Route.get("/demo/form").use(() => {
	return (
		<Layout head={<Meta {...formContent.frontmatter} />}>
			<h1>{formContent.frontmatter.title}</h1>

			{Render.raw({ markup: formContent.html })}

			<enroll.Form />
		</Layout>
	);
});
