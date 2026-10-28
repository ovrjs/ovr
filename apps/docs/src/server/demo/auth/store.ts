import type { Auth } from "ovr";

/** Development-only account records. */
export const users = new Map<string, { id: string; email: string }>();
/** Development-only credential records. */
export const credentials = new Map<string, Auth.Credential>();

/** In-memory adapters for the local demo; use shared, atomic storage in production. */
export function options(
	secret: string,
	origin = "https://localhost:5173",
): Auth.Options {
	const challenges = new Map<string, Auth.Challenge>();
	const sessions = new Map<string, Auth.Session>();
	return {
		secret,
		origin,
		name: "ovr demo",
		challenges: {
			set(id, value) {
				for (const [key, record] of challenges)
					if (record.expiration <= Date.now()) challenges.delete(key);
				challenges.set(id, value);
			},
			take(id) {
				// No await between reading and deleting: atomic in this single process.
				const value = challenges.get(id);
				challenges.delete(id);
				return value;
			},
		},
		sessions: {
			set(id, value) {
				for (const [key, record] of sessions)
					if (record.expiration <= Date.now()) sessions.delete(key);
				sessions.set(id, value);
			},
			get: (id) => sessions.get(id),
			delete(id) {
				sessions.delete(id);
			},
		},
	};
}
