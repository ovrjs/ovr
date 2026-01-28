import * as schemaContent from "@/server/demo/schema/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Render, Route, Schema } from "ovr";

export const create = Route.post(
	{
		username: Schema.Field.text(),
		email: Schema.Field.email(),
		age: Schema.Field.number(),
		house: Schema.Field.select([
			"Gryffindor",
			"Hufflepuff",
			"Ravenclaw",
			"Slytherin",
		]),
		color: Schema.Field.radio(["Green", "Red", "Blue"]),
	},
	async (c) => {
		const data = await c.data();
		console.log(data);

		return c.redirect(schema);
	},
);

export const schema = Route.get("/demo/schema", (c) => {
	const Layout = createLayout(c);

	const House = create.field("house");
	const Color = create.field("color");

	return (
		<Layout head={<Meta {...schemaContent.frontmatter} />}>
			<h1>{schemaContent.frontmatter.title}</h1>
			{Render.html(schemaContent.html)}
			<create.Form class="bg-muted border-secondary grid gap-4 rounded-md border p-4 capitalize sm:max-w-sm" />

			<House.Root>
				<House.Label />
				<House.Control>
					{House.values.map((v) => (
						<House.Option value={v} />
					))}
				</House.Control>
				<House.Error />
			</House.Root>

			<Color.Root>
				<Color.Legend />
				{Color.values.map((v) => {
					return (
						<div>
							<Color.Label value={v} />
							<Color.Control value={v} />
						</div>
					);
				})}
			</Color.Root>
		</Layout>
	);
});
