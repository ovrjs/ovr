import { create } from "./create";
import { order } from "./routes";
import { Field, Route } from "ovr";

const action = Route.post(
	{
		name: Field.text(), // <input type=text>
		notes: Field.textarea(), // <textarea>
		quantity: Field.number(), // <input type=number>
	},
	async (c) => {
		const result = await c.data(); // parse form data

		if (result.issues) {
			return c.redirect(page.url({ search: result.search }), 303); // redirect to submitted page
		}

		const id = await create(
			result.data, // { name: string; notes: string; quantity: number; }
		);

		return c.redirect(order.pathname(id), 303);
	},
);

const page = Route.get("/order", () => {
	return <action.Form />; // <form>(fields)</form>
});
