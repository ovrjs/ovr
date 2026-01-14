import * as content from "@/lib/content";
import * as demo from "@/server/demo";
import * as docs from "@/server/docs";
import * as home from "@/server/home";
import * as notFound from "@/server/mw/not-found";
import * as redirect from "@/server/mw/redirect";
import * as seo from "@/server/seo";
import "dotenv/config";
import * as o from "ovr";

if (!process.env.AUTH_SECRET) throw new Error("No auth secret set");

/** Stored credential data */
type Credential = { id: string; publicKey: string };

/** User with passkey credentials */
type User = { id: string; credentials: Credential[] };

/** In-memory user store (demo only) */
export const users = new Set<User>();

const app = new o.App({
	auth: {
		secret: process.env.AUTH_SECRET,
		redirect: { register: "/admin", login: "/admin" },
		credential: {
			store(result) {
				// Create user if doesn't exist
				let user = users.values().find((u) => u.id === result.user);
				if (!user) {
					user = { id: result.user, credentials: [] };
					users.add(user);
				}
				// Store credential
				user.credentials.push({ id: result.id, publicKey: result.publicKey });
			},
			get(credentialId) {
				for (const user of users) {
					const cred = user.credentials.find((c) => c.id === credentialId);
					if (cred) return { ...cred, user: user.id };
				}
				return null;
			},
		},
	},
});

app.use(redirect, notFound, home, docs, demo, seo);

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

export default {
	fetch: app.fetch,
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
