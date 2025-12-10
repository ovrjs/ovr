import * as content from "@/lib/content";
import * as demo from "@/server/demo";
import * as docs from "@/server/docs";
import * as home from "@/server/home";
import * as notFound from "@/server/mw/not-found";
import * as redirect from "@/server/mw/redirect";
import * as o from "ovr";

const app = new o.App();

app.use(redirect, notFound, home, docs, demo);

if (import.meta.env.DEV) {
	app.use(
		o.Route.get("/backpressure", async (c) => {
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

const docPrerender = content.slugs().map((slug) => "/" + slug);

export default {
	fetch: app.fetch,
	prerender: [
		home.page.pathname(),
		docs.llms.pathname(),
		...docPrerender,
		...docPrerender.map((p) => p + ".md"),
	],
};
