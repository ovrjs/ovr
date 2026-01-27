import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Route, Schema } from "ovr";

const User = Schema.form({
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
});

export const page = Route.get("/demo/schema", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta title="Schema" description="Schema validation" />}>
			<h1>Schema</h1>
			<create.Form class="bg-muted border-secondary grid gap-2 rounded-md border p-4 sm:max-w-sm">
				<User.Fields />
				<button>Submit</button>
			</create.Form>
		</Layout>
	);
});

export const create = Route.post((c) => {
	const data = c.form().parse(User);
	console.log(data);

	return c.redirect(page);
});
