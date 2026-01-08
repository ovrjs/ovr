import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { JSX, type Middleware, Render, Route } from "ovr";

/** Stored credential data */
type StoredCredential = { id: string; publicKey: string };

/** User with passkey credentials */
type User = { id: string; credentials: StoredCredential[] };

/** In-memory user store (demo only) */
const users = new Set<User>();

/** Parse and validate credential from form data */
const parseCredential = (formData: FormData) => {
	const value = formData.get("credential");

	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (typeof parsed?.id === "string") {
				return parsed;
			}
		} catch {}
	}

	return null;
};

/** Store a credential for a user during registration */
const storeCredential = async (userId: string, verified: any) => {
	const user = users.values().find((u) => u.id === userId);
	if (!user) return;

	user.credentials.push({
		id: verified.credentialId,
		publicKey: verified.publicKey,
	});
};

/** Get a credential by ID and return both credential and associated user */
const getCredentialById = (credentialId: string) => {
	for (const user of users) {
		const credential = user.credentials.find((c) => c.id === credentialId);
		if (credential) return { user, credential };
	}
	return null;
};

/** Get all credentials for a user */
const getUserCredentials = (userId: string): StoredCredential[] => {
	const user = users.values().find((u) => u.id === userId);
	return user?.credentials ?? [];
};

/** Middleware to protect routes - require authentication */
const withAuth = (
	handler: (
		c: Middleware.Context,
		session: Middleware.Context.Auth.Session,
	) => JSX.Element,
): Middleware => {
	return async (c) => {
		const session = await c.auth.session();

		if (session) return handler(c, session);

		c.res.status = 401;
		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>Unauthorized</h1>
				<auth.Anchor>Login</auth.Anchor>
			</Layout>
		);
	};
};

/** Landing page - registration + sign in options */
export const auth = Route.get("/demo/auth", async (c) => {
	const Layout = createLayout(c);

	// Generate passkey options for registration
	const userId = crypto.randomUUID();
	const createOptions = await c.auth.passkey.create({
		id: userId,
		name: `user-${userId}`,
		displayName: "Passkey",
	});

	return (
		<Layout head={<Meta {...content.frontmatter} />}>
			<h1>{content.frontmatter.title}</h1>

			{Render.html(content.html)}

			<div class="mb-4 flex gap-2">
				<registerVerify.Form>
					<button>Create passkey</button>
				</registerVerify.Form>

				<login.Anchor class="button secondary">Sign in</login.Anchor>
			</div>

			<admin.Anchor>Admin</admin.Anchor>

			<WebAuthn
				route={registerVerify}
				method="create"
				passkey={createOptions}
				userId={userId}
			/>
		</Layout>
	);
});

/** Verify registration - create user, parse credential, verify, store, login */
export const registerVerify = Route.post(async (c) => {
	const formData = await c.form().data();

	const credential = await parseCredential(formData);
	if (!credential) return c.text("Invalid request", 400);

	const verified = await c.auth.passkey.verify(credential);

	// Get userId from form data
	const userId = formData.get("userId");

	if (typeof userId !== "string") {
		return c.text("Invalid request", 400);
	}

	// Create user in store if doesn't exist
	if (!users.values().find((u) => u.id === userId)) {
		users.add({ id: userId, credentials: [] });
	}

	await storeCredential(userId, verified);

	await c.auth.login(userId);

	c.redirect(admin.url(), 303);
});

/** Login page - create passkey options for authentication */
export const login = Route.get("/auth/login", async (c) => {
	const Layout = createLayout(c);
	const session = await c.auth.session();

	if (session) {
		c.redirect(admin.url(), 303);
		return;
	}

	const getOptions = await c.auth.passkey.get();

	return (
		<Layout head={<Meta {...content.frontmatter} />}>
			<h1>Sign in with passkey</h1>

			<loginVerify.Form>
				<button>Sign in</button>
			</loginVerify.Form>

			<WebAuthn route={loginVerify} method="get" passkey={getOptions} />
		</Layout>
	);
});

/** Verify login - parse credential, lookup, verify, login */
export const loginVerify = Route.post(async (c) => {
	const credential = parseCredential(await c.form().data());

	if (!credential) return c.text("Invalid request", 400);

	const lookup = getCredentialById(credential.id);

	if (!lookup) return c.text("Invalid credential", 400);

	const { credential: storedCred } = lookup;

	// Build full Passkey.Credential with userId
	const stored = {
		id: storedCred.id,
		publicKey: storedCred.publicKey,
		userId: lookup.user.id,
	};

	const result = await c.auth.passkey.assert(credential, stored);

	await c.auth.login(result.userId);

	c.redirect(admin.url(), 303);
});

/** Logout - clear session */
export const logout = Route.post((c) => {
	c.auth.logout();
	c.redirect(auth.url(), 303);
});

/** Admin page - show user ID and credentials */
export const admin = Route.get(
	"/admin",
	withAuth(async (c, session) => {
		const credentials = getUserCredentials(session.id);
		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				{() => {
					return (
						<>
							<h1>Admin</h1>
							<p>User ID: {session.id}</p>

							{credentials.length > 0 && (
								<>
									<h2>Registered credentials</h2>
									<ul>
										{credentials.map((cred) => (
											<li key={cred.id}>{cred.id}</li>
										))}
									</ul>
								</>
							)}

							<form>
								<logout.Button>Logout</logout.Button>
							</form>
						</>
					);
				}}
			</Layout>
		);
	}),
);

/** WebAuthn client-side integration - handles passkey creation/authentication */
const WebAuthn = (props: {
	route: Route;
	method: "create" | "get";
	passkey: unknown;
	userId?: string;
}) => (
	<>
		<script type="module">
			{Render.html(`
function decodeBase64Url(str) {
	const binary = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
	return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

function decodeOptions(obj, parentKey = '') {
	if (typeof obj !== 'object' || obj === null) return obj;
	if (Array.isArray(obj)) return obj.map(item => decodeOptions(item, parentKey));
	if (obj instanceof Uint8Array) return obj;
	
	const decoded = {};
	for (const [key, value] of Object.entries(obj)) {
		if (typeof value === 'string') {
			// Only decode specific known binary fields
			if (key === 'challenge' || (parentKey === 'user' && key === 'id')) {
				decoded[key] = decodeBase64Url(value);
			} else {
				decoded[key] = value;
			}
		} else {
			decoded[key] = decodeOptions(value, key);
		}
	}
	return decoded;
}

const options = ${JSON.stringify(props.passkey)};
const decodedOptions = decodeOptions(options);

const form = document.querySelector('form[action="${props.route.url()}"]')

form.addEventListener("submit", async (e) => {
	e.preventDefault();

	const credential = await navigator.credentials.${props.method}({ publicKey: decodedOptions });

	const { action, method } = form;
	
	const body = new FormData();
	body.append("credential", JSON.stringify(credential.toJSON()));
	body.append("userId", "${props.userId}")

	const res = await fetch(action, { method, body });

	if (res.ok) window.location.href = res.url;
});
`)}
		</script>
		<noscript>JavaScript is required for authentication.</noscript>
	</>
);
