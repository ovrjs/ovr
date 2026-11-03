import * as content from "@/lib/content";
import * as demo from "@/server/demo";
import * as docs from "@/server/docs";
import * as home from "@/server/home";
import * as notFound from "@/server/mw/not-found";
import * as redirect from "@/server/mw/redirect";
import * as seo from "@/server/seo";
import "dotenv/config";
import * as o from "ovr";

let app: o.App;
if (import.meta.env.DEV && process.env.AUTH_SECRET) {
	const auth = await import("@/server/demo/auth");
	const { open } = await import("@/server/demo/auth/store");
	const database = await open(process.env.AUTH_DATABASE);
	const service = auth.configure(
		database,
		process.env.AUTH_SECRET,
		process.env.AUTH_ORIGIN,
	);
	app = new o.App().use(service, auth.routes(database, service));
} else app = new o.App();

app.use(redirect, notFound, home, docs, demo, seo);

if (import.meta.env.DEV) {
	app.use(
		o.Route.get("/backpressure").use(async (c) => {
			// need to make each chunk is very large to observe pull stop
			// log something in the Context.page => pull method to see
			const res = await fetch("http://localhost:5173/demo/memory");

			// Manually consume the stream slowly
			const reader = res.body!.getReader();

			while (true) {
				// Only read every 100ms to simulate slow client
				await new Promise((resolve) => setTimeout(resolve, 100));
				const { done, value } = await reader.read();
				console.log(`Read ${value?.length} bytes`);
				if (done) break;
			}

			c.text("done");
		}),
	);
}

export default {
	// The auth demo is local-development-only. Production entry points must supply their actual trusted peer IP.
	fetch: (request: Request) =>
		app.fetch(request, import.meta.env.DEV ? { ip: "127.0.0.1" } : {}),
	prerender: () => {
		const docPrerender = content.slugs().map((slug) => "/" + slug);

		return [
			home.page.pathname(),
			docs.llms.pathname(),
			seo.robots.pathname(),
			seo.sitemap.pathname(),
			...docPrerender,
			...docPrerender.map((p) => p + ".md"),
		];
	},
};
