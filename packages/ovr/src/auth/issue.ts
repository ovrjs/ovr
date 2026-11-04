import { Limit, Malformed } from "../multipart/index.js";

/**
 * Auth validation issue.
 *
 * Used for non-schema auth/passkey validation failures.
 */
export class Issue extends Error {
	/**
	 * @param expected Expected auth value/state
	 * @returns Normalized issue message
	 */
	static m(expected: string) {
		return `Invalid ${expected}`;
	}

	/**
	 * For `c.data().catch(Issue.body)` in Auth's handlers, which answer a
	 * body that is too large or not form data like any other failed form.
	 *
	 * @param error Error from `c.data()`
	 * @returns `null` for a body the client got wrong
	 * @throws Any other error
	 */
	static body(error: unknown): null {
		if (error instanceof Limit || error instanceof Malformed) return null;
		throw error;
	}

	/**
	 * Create a new auth issue.
	 *
	 * @param expected Expected auth value/state
	 */
	constructor(expected: string) {
		super(Issue.m(expected));

		this.name = "Auth.Issue";
	}
}
