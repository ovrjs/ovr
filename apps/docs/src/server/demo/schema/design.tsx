// @ts-nocheck
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Route, Schema } from "ovr";

export const page = Route.get("/demo/schema", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta title="Schema" description="Schema validation" />}>
			<h1>Schema</h1>
			<create.Form class="bg-muted border-secondary grid gap-2 rounded-md border p-4 sm:max-w-sm" />
		</Layout>
	);
});

export const create = Route.post(
	{
		username: Schema.Field.text(),
		email: Schema.Field.email(),
		age: Schema.Field.number(),
		birthday: Schema.Field.date(),
		house: Schema.Field.radio([
			"Gryffindor",
			"Hufflepuff",
			"Ravenclaw",
			"Slytherin",
		]),
	},
	async (c) => {
		const data = await c.data();
		console.log(data);

		return c.redirect(page);
	},
);

create.Fields;
create.Field;
create.parse;
create.field;
