import type { Middleware } from "ovr";

const permanent: Record<string, string> = {
	"/02-components": "/02-render",
	"/04-helpers": "/04-route",
	"/05-context": "/05-middleware#context",
	"/06-routing": "/04-route",
	"/07-memo": "https://blog.robino.dev/posts/simple-memo",
};

export const redirect: Middleware = async (c, next) => {
	await next();

	const to = permanent[c.url.pathname];

	if (to) c.redirect(to, 301);
};
