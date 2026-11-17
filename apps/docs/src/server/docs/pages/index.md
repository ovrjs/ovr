---
title: Pages
description: What a route waits for, and what the components on its page read for themselves.
---

## The rules

- **A route waits only for what decides the response:** the redirect, the 404, headers and cookies, and what the head needs, such as the title.
- **Every other part of the page is a component that reads its own data.**
- **A component takes IDs and plain values as props,** not the data itself.
- **Reads go through shared data functions,** so parts that need the same data read it once.
- **Writes stay in route handlers.**

## A page

A post with its author, its comments, and a way to reply. The route reads the post, since a missing one is a 404 and its title is in the head. Each part reads the rest for itself:

```tsx
import { type Context, Route } from "ovr";

const page = Route.get("/posts/:id").use(async (c) => {
	const { id } = c.params;
	const [post] = await c.memo(postOf)(id);
	if (!post) return c.text("Not found", 404);

	return (
		<Layout title={post.title}>
			<Post id={id} />
			<Comments post={id} />
			<Reply post={id} />
		</Layout>
	);
});

async function Post(props: { id: string }, c: Context) {
	// the route's read, so no query
	const [post] = await c.memo(postOf)(props.id);
	if (!post) return;

	return (
		<article>
			<h1>{post.title}</h1>
			<Byline user={post.author} />
			<p>{post.body}</p>
		</article>
	);
}

async function Comments(props: { post: string }, c: Context) {
	const comments = await c.memo(commentsOf)(props.post);

	return (
		<ul>
			{comments.map((comment) => (
				<li>
					{comment.body}
					<Byline user={comment.author} />
				</li>
			))}
		</ul>
	);
}

async function Byline(props: { user: string }, c: Context) {
	// one query for each author, however many comments are theirs
	const [user] = await c.memo(userOf)(props.user);

	return <p>By {user?.name ?? "someone"}</p>;
}

async function Reply(props: { post: string }, c: Context) {
	if (!(await c.session())) return <a href="/login">Sign in to reply</a>;

	return <reply.Form params={{ id: props.post }} submit="Reply" />;
}
```

- **The page starts sooner.** The document is sent as soon as the route returns, and each part follows when its own read is done.
- **Parts read at the same time.** Components beside each other [render in parallel](/render#parallelization), so their queries do not wait in a line.
- **A part goes on any page.** `<Comments post={id} />` works wherever there is a post's ID, with no change to that page's route.
- **Agents get the same parts.** A page read as [Markdown](/agents#markdown) renders the same components.

## Compared to reading in the route

A route can read everything first and pass the data down, as a loader does in other frameworks:

```tsx
const page = Route.get("/posts/:id").use(async (c) => {
	const [[post], comments] = await Promise.all([
		postOf(c.params.id),
		commentsOf(c.params.id),
	]);
	if (!post) return c.text("Not found", 404);

	return (
		<Layout title={post.title}>
			<Post post={post} />
			<Comments comments={comments} />
		</Layout>
	);
});
```

It works, at two costs. Nothing is sent until the slowest read is done. And the route has to know what every part needs, so a part can't go on another page without that page's route reading for it too.

## Props are IDs

Give a component the ID of what it shows, not the data: `<Comments post={id} />`, not `<Comments comments={comments} />`. A component that takes data can only be used where something has read it. One that takes an ID reads for itself, and [`c.memo`](/render#shared-reads) makes a read that already happened free.

## Data functions

The functions a page reads through are the app's data layer. Write each once, outside of any component, taking IDs and other plain values, and call it from routes and components alike through `c.memo`:

```ts
export const postOf = (id: string) =>
	database.sql`
		SELECT * FROM ${database.posts}
		WHERE ${database.posts.columns.id} = ${id}
	`.parse(database.posts);

export const commentsOf = (post: string) =>
	database.sql`
		SELECT * FROM ${database.comments}
		WHERE ${database.comments.columns.post} = ${post}
	`.parse(database.comments);

export const userOf = (id: string) =>
	database.sql`
		SELECT * FROM ${database.users}
		WHERE ${database.users.columns.id} = ${id}
	`.parse(database.users);
```

In a larger app they are a module of their own, which every page imports.

## The head

The head is why a route reads a row at all: the title, the description, and the image a link preview shows are sent first, before any part of the page. Read them in the route through the same function the component uses, as `postOf` is above. The route's read is the component's too, so the component costs nothing more.

## What stays in the route

- **Redirects and 404s.** They are the response's status, which is sent before the page. A route that needs someone signed in is wrapped in [`auth.guard`](/auth#sessions).
- **Headers and cookies.** A component runs once the response has begun, so its [`Context`](/render#context) has no way to set them.
- **Parsing the request**, with `c.data()`.
- **Writes.** A POST handler changes what it must and redirects, and the page it redirects to reads again.

## Errors while a page streams

An error in a route handler reaches your [errors middleware](/middleware#not-found-and-errors), which answers with a 500. An error in a component comes after the response has started: the status is already 200, the stream ends where the component failed, and the middleware never sees it. A browser shows the part of the page that arrived, and an agent gets Markdown that stops short.

So keep what can fail the request in the route, and make each component safe for what it reads:

- Check that the record exists, and that the user may see it, in the route. That is the 404 and the redirect.
- A component that finds nothing renders nothing, or says so: an empty list is not an error.
- A read that can fail on its own, such as another service, is caught where it is made. The component reports the error, since nothing else will, and renders what to show without it.

```tsx
async function Weather(props: { city: string }) {
	try {
		const res = await fetch(`https://weather.example/${props.city}`);
		const { summary } = (await res.json()) as { summary: string };

		return <p>{summary}</p>;
	} catch (error) {
		console.error(error); // or your error tracker

		return <p>The weather is unavailable.</p>;
	}
}
```
