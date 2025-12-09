import * as chatContent from "@/server/demo/chat/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import "dotenv/config";
import * as ovr from "ovr";
import * as z from "zod";

async function* Poet(props: { message: string }) {
	const { OpenAI } = await import("openai");
	const client = new OpenAI();

	const response = client.responses.stream({
		input: props.message,
		instructions: "You turn messages into poems.",
		model: "gpt-5-nano",
		reasoning: { effort: "minimal" },
		text: { verbosity: "low" },
	});

	for await (const event of response) {
		if (event.type === "response.output_text.delta") yield event.delta;
	}
}

export const chat = ovr.Route.get("/demo/chat", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...chatContent.frontmatter} />}>
			<h1>{chatContent.frontmatter.title}</h1>

			{ovr.Render.html(chatContent.html)}

			<hr />

			<stream.Form class="bg-muted border-secondary grid max-w-sm gap-4 rounded-md border p-4">
				<div>
					<label for="message">Message</label>
					<textarea
						name="message"
						id="message"
						placeholder="Create a poem from a message"
					></textarea>
				</div>
				<button>Send</button>
			</stream.Form>
		</Layout>
	);
});

export const stream = ovr.Route.post(async (c) => {
	const Layout = createLayout(c);

	const data = await c.req.formData();
	const message = z.string().parse(data.get("message"));

	return (
		<Layout head={<Meta title="Message" description="Generated message." />}>
			<h1>Poem</h1>

			<div class="flex flex-col-reverse">
				<chat.Anchor>Back to chat</chat.Anchor>

				<blockquote class="bg-muted rounded-md p-6 shadow-md">
					<Poet message={message} />
				</blockquote>
			</div>
		</Layout>
	);
});
