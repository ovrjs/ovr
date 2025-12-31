import { Codec } from "../util/index.js";

/**
 * Cryptographic primitives.
 *
 * Provides utilities for:
 * - Hashing and verifying low-entropy secrets (passwords, PINs, etc.)
 * - Generating cryptographically secure random secrets
 *
 * This module is intentionally minimal and stateless. It does not manage
 * users, sessions, or authentication flows. Higher-level authentication
 * concerns are handled elsewhere.
 */
export class Crypto {
	/**
	 * PBKDF2 hashing parameters.
	 *
	 * These values define the single supported password hashing configuration
	 * for the current version of ovr. Parameters are embedded in the stored
	 * hash to allow future versions of ovr to intentionally migrate defaults
	 * without breaking existing hashes.
	 */
	static readonly #params = {
		name: "PBKDF2",
		hash: "SHA-256",
		iterations: 600_000,
	} as const;

	/**
	 * Constant-time comparison of two byte arrays.
	 *
	 * Used to prevent timing attacks when comparing derived keys.
	 */
	static #timingSafeEqual(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;

		let diff = 0;
		for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;

		return diff === 0;
	}

	/**
	 * Parse and validate a stored hash string.
	 *
	 * Ensures the hash was created using the currently supported algorithm
	 * and parameters, and performs basic structural validation of decoded
	 * components.
	 */
	static #parse(stored: string) {
		const [name, hash, iter, saltB64, derivedB64] = stored.split("$", 5);
		const iterations = Number(iter);

		if (
			name === Crypto.#params.name &&
			hash === Crypto.#params.hash &&
			iterations === Crypto.#params.iterations &&
			saltB64 &&
			derivedB64
		) {
			try {
				const salt = Codec.base64.decode(saltB64);
				const expected = Codec.base64.decode(derivedB64);

				if (
					salt.length >= 8 &&
					salt.length <= 128 &&
					expected.length >= 16 &&
					expected.length <= 128
				) {
					return { name, hash, iterations, salt, expected };
				}
			} catch {}
		}

		return null;
	}

	/**
	 * Hash a low-entropy secret for storage.
	 *
	 * This method is intended for secrets such as passwords, PINs, or recovery
	 * codes. It uses PBKDF2 with a per-hash random salt and fixed parameters.
	 *
	 * @param secret Secret value to hash
	 * @returns Encoded hash string containing all required parameters
	 */
	static async hash(secret: string) {
		const salt = crypto.getRandomValues(new Uint8Array(16));

		return [
			Crypto.#params.name,
			Crypto.#params.hash,
			Crypto.#params.iterations,
			Codec.base64.encode(salt),
			Codec.base64.encode(
				new Uint8Array(
					await crypto.subtle.deriveBits(
						{ ...Crypto.#params, salt },
						await crypto.subtle.importKey(
							"raw",
							Codec.encode(secret),
							Crypto.#params.name,
							false,
							["deriveBits"],
						),
						256,
					),
				),
			),
		].join("$");
	}

	/**
	 * Verify a secret against a previously generated hash.
	 *
	 * @param secret Secret value to verify
	 * @param stored Hash string returned by `Crypto.hash`
	 * @returns `true` if the secret matches the stored hash, otherwise `false`
	 */
	static async verify(secret: string, stored: string) {
		const parse = Crypto.#parse(stored);
		if (!parse) return false;

		const { expected, ...params } = parse;

		return Crypto.#timingSafeEqual(
			new Uint8Array(
				await crypto.subtle.deriveBits(
					params,
					await crypto.subtle.importKey(
						"raw",
						Codec.encode(secret),
						params.name,
						false,
						["deriveBits"],
					),
					expected.length * 8,
				),
			),
			expected,
		);
	}

	/**
	 * Generate a cryptographically secure random secret.
	 *
	 * Intended for use as application-level secrets such as
	 * `App.Options.auth.secret`. This value should be generated once and
	 * stored securely (for example, in an environment variable).
	 *
	 * @returns Random base64-encoded secret
	 */
	static secret() {
		return btoa(
			String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
		);
	}
}
