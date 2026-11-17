---
title: Pages
description: What a route waits for, and what the components on its page read for themselves.
---

## The rule

A route waits only for what decides the response: the redirect, the 404, headers and cookies, and what the head needs, such as the title. Every other part of the page is a component that takes IDs and plain values as props, reads its own data, and calls shared data functions so parts that need the same rows share one query. Writes stay in route handlers.

## Before and after

A recipe page with its cook log and a way to share it. Read everything in the route, and the page waits for the slowest query before its first byte is sent:

```tsx
const page = Route.get("/recipes/:id").use(async (c) => {
	const session = await c.session();
	if (!session) return c.redirect("/login", 303);

	const [[recipe], cooks, friends] = await Promise.all([
		recipeOf(c.params.id),
		cooksOf(c.params.id),
		friendsOf(session.user),
	]);
	if (!recipe) return c.text("Not found", 404);

	return (
		<Layout title={recipe.title}>
			<Recipe recipe={recipe} />
			<CookLog cooks={cooks} />
			<Share recipe={recipe} friends={friends} />
		</Layout>
	);
});
```

The route knows what every part needs, so a part can't go on another page without that page's route reading for it too.

Let each part read what it shows, and the route waits only for what decides the response:

```tsx
const page = Route.get("/recipes/:id").use(
	auth.guard(async (c) => {
		const { id } = c.params;
		const [recipe] = await c.memo(recipeOf)(id);
		if (!recipe) return c.text("Not found", 404);

		return (
			<Layout title={recipe.title}>
				<Recipe id={id} />
				<CookLog recipe={id} />
				<Share recipe={id} />
			</Layout>
		);
	}),
);

async function Recipe(props: { id: string }, c: Context) {
	// the route's read, so no query
	const [recipe] = await c.memo(recipeOf)(props.id);
	if (!recipe) return;

	return <h1>{recipe.title}</h1>;
}

async function CookLog(props: { recipe: string }, c: Context) {
	const cooks = await c.memo(cooksOf)(props.recipe);

	return (
		<ul>
			{cooks.map((cook) => (
				<li>{cook.note}</li>
			))}
		</ul>
	);
}

async function Share(props: { recipe: string }, c: Context) {
	const session = await c.session();
	if (!session) return;

	const friends = await c.memo(friendsOf)(session.user);
	const form = share.form(undefined, { id: props.recipe });

	return (
		<form.Form submit="Share">
			<form.Field
				name="friend"
				options={Object.fromEntries(friends.map((f) => [f.id, f.name]))}
			/>
		</form.Form>
	);
}
```

- **The page starts sooner.** The document is sent as soon as the route returns, and each part follows when its own read is done.
- **Parts read at the same time.** Components beside each other [render in parallel](/render#parallelization), so the queries are not in a line.
- **A part goes on any page.** `<CookLog recipe={id} />` works wherever there is a recipe's ID, with no change to that page's route.
- **Agents get the same parts.** A page read as [Markdown](/agents#markdown) renders the same components.

## Props are IDs

Give a component the ID of what it shows, not the rows: `<CookLog recipe={id} />`, not `<CookLog cooks={rows} />`. A component that takes rows can only be used where something has read them. One that takes an ID reads for itself, and [`c.memo`](/render#shared-reads) makes a read that already happened free.

## Data functions

The functions a page reads through are the app's data layer. Write each once, outside of any component, taking IDs and other plain values, and call it from routes and components alike through `c.memo`:

```ts
export const recipeOf = async (id: string) =>
	database.sql`
		SELECT * FROM ${database.recipes}
		WHERE ${database.recipes.columns.id} = ${id}
	`.parse(database.recipes);

export const cooksOf = async (recipe: string) =>
	database.sql`
		SELECT * FROM ${database.cooks}
		WHERE ${database.cooks.columns.recipe} = ${recipe}
	`.parse(database.cooks);
```

In a larger app they are a module of their own, which every page imports.

## The head

The head is why a route reads a row at all: the title, the description, and the image a link preview shows are sent first, before any part of the page. Read them in the route through the same function the component uses, as `recipeOf` is above. The route's read is the component's too, so the component costs nothing more.

## What stays in the route

- **Redirects and 404s.** They are the response's status, which is sent before the page.
- **Headers and cookies.** A component runs once the response has begun, so its [`Context`](/render#context) has no way to set them.
- **Parsing the request**, with `c.data()`.
- **Writes.** A POST handler changes what it must and redirects; the page it redirects to reads it again.

## Errors while a page streams

An error in a route handler reaches your [errors middleware](/middleware#not-found-and-errors), which answers with a 500. An error in a component comes after the response has started: the status is already 200, the stream ends where the component failed, and the middleware never sees it. A browser shows the part of the page that arrived, and an agent gets Markdown that stops short.

So keep what can fail the request in the route, and make each component safe for what it reads:

- Check that the record exists, and that the user may see it, in the route. That is the 404 and the redirect.
- A component that finds nothing renders nothing, or says so: an empty list is not an error.
- A read that can fail on its own, such as another service, is caught where it is made, and the component renders what to show without it.

```tsx
async function Weather(props: { city: string }) {
	try {
		const res = await fetch(`https://weather.example/${props.city}`);
		const { summary } = (await res.json()) as { summary: string };

		return <p>{summary}</p>;
	} catch {
		return <p>The weather is unavailable.</p>;
	}
}
```
