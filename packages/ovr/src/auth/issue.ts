/**
 * Auth validation issue.
 *
 * Used for non-schema auth/passkey validation failures.
 */
export class AuthIssue extends Error {
	/** Expected auth value/state. */
	readonly expected: string;

	/**
	 * Build a normalized auth issue message.
	 *
	 * @param expected Expected auth value/state
	 * @returns Normalized issue message
	 */
	static message(expected: unknown) {
		return `Invalid ${String(expected)}`;
	}

	/**
	 * Create a new auth issue.
	 *
	 * @param expected Expected auth value/state
	 * @param message Issue message
	 */
	constructor(expected: unknown, message = AuthIssue.message(expected)) {
		super(message);

		this.name = "Auth.Issue";
		this.expected = String(expected);
	}
}
