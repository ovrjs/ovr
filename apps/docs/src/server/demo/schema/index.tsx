import * as schemaContent from "@/server/demo/schema/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Render, Route, Schema } from "ovr";

const student = Schema.form({
	name: Schema.Field.text({ placeholder: "Harry Potter" }).refine(
		(v) => v.trim().length >= 2,
		"Expected at least 2 characters",
	),
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
	pet: Schema.Field.checkboxes(["Owl", "Cat", "Toad"]),
	arrival: Schema.Field.date().transform((d) => d || "2026-09-01"),
	rules: Schema.Field.checkbox().refine(
		(v) => v,
		"You must accept the castle rules",
	),
	license: Schema.Field.file().stream(), // put stream last to parse fields first
});

export const enroll = Route.post(student, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	if (result.parts) {
		for await (const part of result.parts) {
			console.log(part);
			await part.bytes();
		}
	}

	// create new student record...

	c.redirect(schema, 303);
});

export const schema = Route.get("/demo/schema", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...schemaContent.frontmatter} />}>
			<h1>{schemaContent.frontmatter.title}</h1>

			{Render.html(schemaContent.html)}

			<enroll.Form state={c.url} />
		</Layout>
	);
});
