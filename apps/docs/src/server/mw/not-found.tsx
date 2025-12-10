import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as o from "ovr";

export const notFound: o.Middleware = async (c, next) => {
	await next();

	if (c.res.body === undefined) {
		c.res.status = 404;

		const Layout = createLayout(c);

		return (
			<Layout
				head={<Meta title="Not Found" description="Content not found." />}
			>
				<h1>Not Found</h1>

				<p>
					<button
						type="button"
						class="mb-6 cursor-pointer"
						onclick="history.back()"
					>
						Back
					</button>

					<a href="/">Return home</a>
				</p>
			</Layout>
		);
	}
};
