import { Render, Route } from "ovr";
import { z } from "zod";

const CredentialSchema = z
	.string()
	.min(100)
	.transform((s) => JSON.parse(s) as unknown);

// TODO: Implement these in your application
async function storeCredential(_verified: any) {}
async function getCredential(_id: string) {
	return {} as any;
}

export const register = Route.get("/register", async (c) => {
	const user = { id: `user-${crypto.randomUUID()}` };

	const publicKey = await c.auth.passkey.create({
		id: user.id,
		name: `user-${user.id}`,
		displayName: "Account",
	});

	return (
		<>
			<h1>Create account</h1>

			<registerVerify.Form>
				<button>Create passkey</button>
			</registerVerify.Form>

			<WebAuthn route={registerVerify} method="create" publicKey={publicKey} />
		</>
	);
});

export const registerVerify = Route.post(async (c) => {
	const data = await c.form().data();

	const parsed = CredentialSchema.safeParse(data.get("credential"));

	if (!parsed.success) return c.text("Invalid request", 400);

	const verified = await c.auth.passkey.verify(parsed.data as any);

	// TODO: Implement your credential storage
	await storeCredential(verified);

	c.redirect("/login", 303);
});

export const login = Route.get("/login", async (c) => {
	const publicKey = await c.auth.passkey.get();

	return (
		<>
			<h1>Sign in</h1>

			<loginVerify.Form>
				<button>Sign in with passkey</button>
			</loginVerify.Form>

			<WebAuthn route={loginVerify} method="get" publicKey={publicKey} />
		</>
	);
});

export const loginVerify = Route.post(async (c) => {
	const data = await c.form().data();

	const parsed = CredentialSchema.safeParse(data.get("credential"));

	if (!parsed.success) return c.text("Invalid request", 400);

	// TODO: Implement your credential lookup
	const stored = await getCredential((parsed.data as any).id);

	const result = await c.auth.passkey.assert(parsed.data as any, stored);

	await c.auth.login(result.userId);

	c.redirect("/", 303);
});

const WebAuthn = (props: {
	route: Route;
	method: "create" | "get";
	publicKey: unknown;
}) => (
	<>
		<script type="module">
			{Render.html(`
document
	.querySelector('form[action="${props.route.url()}"]')
	.addEventListener("submit", async (e) => {
		e.preventDefault();
		const credential = await navigator.credentials.${props.method}({ publicKey: ${JSON.stringify(props.publicKey)} });
		const json = credential.toJSON();
		const input = document.createElement("input");
		input.type = "hidden";
		input.name = "credential";
		input.value = JSON.stringify(json);
		e.currentTarget.appendChild(input);
		e.currentTarget.submit();
	});
`)}
		</script>
		<noscript>JavaScript is required for authentication.</noscript>
	</>
);
