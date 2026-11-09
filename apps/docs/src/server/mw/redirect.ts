import type { Middleware } from "ovr";

const permanent: Record<string, string> = {
	"/02-components": "/render",
	"/04-helpers": "/route",
	"/05-context": "/middleware#context",
	"/06-routing": "/route",
	// the pages were numbered in their URLs
	"/01-get-started": "/get-started",
	"/02-render": "/render",
	"/03-app": "/app",
	"/04-route": "/route",
	"/05-middleware": "/middleware",
	"/06-multipart": "/multipart",
	"/07-schema": "/schema",
	"/08-database": "/database",
	"/09-auth": "/auth",
	"/10-agents": "/agents",
	"/07-memo": "https://blog.robino.dev/posts/simple-memo",
};

export const redirect: Middleware = async (c, next) => {
	await next();

	const to = permanent[c.url.pathname];

	if (to) c.redirect(to, 301);
};
