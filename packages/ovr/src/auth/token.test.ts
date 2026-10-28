import { Token } from "./token.js";
import { expect, test } from "vitest";

test("tokens cannot be substituted between session and passkey purposes", async () => {
	const secret = "test-secret-with-at-least-32-bytes";
	const cookie = await Token.seal(secret, "session", "token");
	expect(await Token.open(secret, "session", cookie)).toBe("token");
	await expect(Token.open(secret, "passkey", cookie)).rejects.toThrow("token");
	await expect(
		Token.open(
			secret,
			"session",
			cookie.replace("session:token", "session:other"),
		),
	).rejects.toThrow("token");
	await expect(Token.open(secret + "other", "session", cookie)).rejects.toThrow(
		"token",
	);
});
