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

test("secret rotation signs with the first key and accepts retained keys", async () => {
	const old = "old-signing-secret-with-at-least-32-bytes";
	const current = "new-signing-secret-with-at-least-32-bytes";
	const cookie = await Token.seal(old, "session", "id");
	expect(await Token.open([current, old], "session", cookie)).toBe("id");
	await expect(Token.open(current, "session", cookie)).rejects.toThrow("token");
	const fresh = await Token.seal([current, old], "session", "id");
	expect(await Token.open(current, "session", fresh)).toBe("id");
	await expect(Token.open(old, "session", fresh)).rejects.toThrow("token");
});
