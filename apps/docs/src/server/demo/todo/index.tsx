import * as todoContent from "@/server/demo/todo/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { type Middleware, Render, Route, Schema } from "ovr";

export const add = Route.post(async (c) => {
	const todos = getTodos(c);
	const { text } = await data(c);
	todos.push({ id: (todos.at(-1)?.id ?? 0) + 1, text, done: false });
	redirect(c, todos);
});

export const toggle = Route.post(async (c) => {
	const todos = getTodos(c);
	const { id } = await data(c);
	const current = todos.find((t) => t.id === id);
	if (current) current.done = !current.done;
	redirect(c, todos);
});

export const remove = Route.post(async (c) => {
	const todos = getTodos(c);
	const { id } = await data(c);
	redirect(
		c,
		todos.filter((t) => t.id !== id),
	);
});

export const todo = Route.get("/demo/todo", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...todoContent.frontmatter} />}>
			<h1>Todo</h1>

			<div class="border-muted mb-12 grid gap-4 rounded-md border p-4 sm:max-w-sm">
				<add.Form search={c.url.search} class="flex gap-4">
					<input name="text" placeholder="Add todo" />
					<button>Add</button>
				</add.Form>

				<ul class="m-0 grid list-none gap-4 p-0">
					{getTodos(c).map((t) => (
						<li class="m-0 p-0">
							<form class="flex justify-between">
								<input type="hidden" name="id" value={t.id} />

								<div class="flex items-center gap-4">
									<toggle.Button
										search={c.url.search}
										class="ghost icon"
										aria-label="toggle todo"
									>
										<span
											class={
												t.done
													? "icon-[lucide--check]"
													: "icon-[lucide--square-dashed]"
											}
										/>
									</toggle.Button>

									<span>{t.text}</span>
								</div>

								<remove.Button
									search={c.url.search}
									class="icon secondary"
									aria-label="delete todo"
								>
									<span class="icon-[lucide--x]" />
								</remove.Button>
							</form>
						</li>
					))}
				</ul>

				<todo.Anchor class="button destructive inline-flex justify-self-end">
					Reset
				</todo.Anchor>
			</div>

			<hr />

			{Render.html(todoContent.html)}
		</Layout>
	);
});

const todoFields = {
	done: Schema.Field.checkbox(),
	id: Schema.Field.number(),
	text: Schema.Field.text(),
};

const todoForm = Schema.form(todoFields);
const todoSchema = Schema.object(todoFields);

const redirect = (
	c: Middleware.Context,
	todos: Schema.Infer<typeof todoSchema>[],
) => {
	const location = new URL(todo.pathname(), c.url);
	location.searchParams.set("todos", JSON.stringify(todos));
	c.redirect(location, 303);
};

const getTodos = (c: Middleware.Context) => {
	const todos = c.url.searchParams.get("todos");
	if (!todos) return [{ done: false, id: 0, text: "Build a todo app" }];

	const result = Schema.array(todoSchema).parse(JSON.parse(todos));

	if (result.issues) throw result;

	return result.data;
};

const data = async (c: Middleware.Context) => {
	const result = todoForm.parse(await c.form().data());

	if (result.issues) throw result;

	return result.data;
};
