/**
 * Auth validation issue.
 *
 * Used for non-schema auth/passkey validation failures.
 */
export class AuthIssue extends Error {
	/**
	 * @param expected Expected auth value/state
	 * @returns Normalized issue message
	 */
	static m(expected: string) {
		return `Invalid ${expected}`;
	}

	/**
	 * Create a new auth issue.
	 *
	 * @param expected Expected auth value/state
	 */
	constructor(expected: string) {
		super(AuthIssue.m(expected));

		this.name = "Auth.Issue";
	}
}
