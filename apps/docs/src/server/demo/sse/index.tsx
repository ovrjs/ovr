import * as sseContent from "@/server/demo/sse/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as ovr from "ovr";

export const ssePage = ovr.Route.get("/demo/sse").use((c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...sseContent.frontmatter} />}>
			<h1>{sseContent.frontmatter.title}</h1>
			{ovr.Html.raw(sseContent.html)}
			<p>
				Check out the server sent events{" "}
				<sse.Anchor data-no-prefetch>demo</sse.Anchor>.
			</p>
		</Layout>
	);
});

// simulate latency
const delay = () => new Promise((r) => setTimeout(r, 300));

export const sse = ovr.Route.get("/sse/event").use((c) => {
	// set the content-type header to create a SSE
	c.res.headers.set("content-type", "text/event-stream");

	// passed into `Html.stream`
	return async function* () {
		yield "data: server\n\n";
		await delay();
		yield "data: sent\n\n";
		await delay();
		yield "data: events\n\n";
	};
});
