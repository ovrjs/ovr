import { Schema } from "../schema/index.js";
import { Table } from "./index.js";
import { describe, expect, test } from "vitest";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Assert<T extends true> = T;

const users = new Table(
	"users",
	{
		id: Schema.string().uuid(),
		email: Schema.string().email(),
		name: Schema.string().nullable(),
		age: Schema.number().int(),
		score: Schema.number(),
		big: Schema.bigint(),
		active: Schema.boolean(),
		created: Schema.date(),
		meta: Schema.object({ theme: Schema.string() }),
		tags: Schema.array(Schema.string()),
		role: Schema.enum(["admin", "user"]),
	},
	{ default: ["id", "created"] },
);

describe("Table", () => {
	test("maps column schemas to kinds of values", () => {
		expect(
			Object.fromEntries(
				Object.values(users.columns).map((c) => [c.name, [c.type, c.nullable]]),
			),
		).toEqual({
			id: ["string", false],
			email: ["string", false],
			name: ["string", true],
			age: ["number", false],
			score: ["number", false],
			big: ["bigint", false],
			active: ["boolean", false],
			created: ["date", false],
			meta: ["json", false],
			tags: ["json", false],
			role: ["string", false],
		});
	});

	test("columns reference their table", () => {
		expect(users.columns.email.table).toBe(users);
		expect(users.columns.email.name).toBe("email");
	});

	test("validates rows as a schema", () => {
		const row = {
			id: crypto.randomUUID(),
			email: "a@example.com",
			name: null,
			age: 1,
			score: 1.5,
			big: 1n,
			active: true,
			created: new Date(),
			meta: { theme: "dark" },
			tags: [],
			role: "user",
		};

		expect(users.parse({ ...row, extra: 1 }).data).toEqual(row);
		expect(users.parse({ ...row, email: "nope" }).issues?.[0]?.path).toEqual([
			"email",
		]);
	});

	test("infers row and insert types", () => {
		type Row = Schema.Infer<typeof users>;
		type Insert = Table.Insert<typeof users.shape, typeof users.options>;

		type RowCheck = Assert<
			Same<
				Pick<Row, "id" | "name" | "created" | "big">,
				{ id: string; name: string | null; created: Date; big: bigint }
			>
		>;
		type InsertCheck = Assert<
			Same<
				Exclude<
					{
						[K in keyof Insert]-?: {} extends Pick<Insert, K> ? K : never;
					}[keyof Insert],
					undefined
				>,
				"id" | "created" | "name"
			>
		>;
		const checks: [RowCheck, InsertCheck] = [true, true];

		expect(checks).toEqual([true, true]);
	});

	test("rejects columns that cannot be stored", () => {
		for (const schema of [
			Schema.string().optional(),
			Schema.string().default("x"),
			Schema.string().nullish(),
			Schema.string().transform((s) => s.length),
			Schema.string().json(Schema.object({})),
			Schema.instance(URL),
			Schema.union([Schema.string(), Schema.number()]),
			Schema.enum(["a", 1]),
		]) {
			expect(() => new Table("t", { c: schema })).toThrow(TypeError);
		}
	});

	test("rejects unknown default columns", () => {
		expect(
			() =>
				new Table("t", { a: Schema.string() }, {
					default: ["b"],
				} as unknown as Table.Options<{ a: Schema<string> }>),
		).toThrow("unknown column b");
		expect(() => new Table("", { a: Schema.string() })).toThrow(TypeError);
	});

	test("rejects nested bigint schemas that the JSON codec cannot store", () => {
		expect(
			() =>
				new Table("entries", {
					metadata: Schema.object({ id: Schema.bigint() }),
				}),
		).toThrow(TypeError);
	});

	test("rejects bigint array items that the JSON codec cannot store", () => {
		expect(
			() => new Table("entries", { ids: Schema.array(Schema.bigint()) }),
		).toThrow(TypeError);
	});

	test("rejects nested transforms whose inferred insert type cannot be parsed", () => {
		expect(
			() =>
				new Table("entries", {
					metadata: Schema.object({ count: Schema.string().transform(Number) }),
				}),
		).toThrow(TypeError);
	});

	test("rejects JSON array items that cannot be read back", () => {
		for (const item of [
			Schema.string().optional(),
			Schema.literal(undefined),
			Schema.enum(["a", undefined]),
			Schema.string().optional().default(undefined),
			Schema.union([Schema.string(), Schema.literal(undefined)]),
		]) {
			expect(() => new Table("t", { c: Schema.array(item) })).toThrow(
				"allow null",
			);
		}

		// undefined becomes null, which these accept, or is never stored
		for (const item of [
			Schema.string().nullable(),
			Schema.string().nullish(),
			Schema.string().default("x"),
			Schema.unknown(),
		]) {
			expect(new Table("t", { c: Schema.array(item) }).columns.c.type).toBe(
				"json",
			);
		}
		expect(
			new Table("t", { c: Schema.object({ d: Schema.string().optional() }) })
				.columns.c.type,
		).toBe("json");
	});
});
