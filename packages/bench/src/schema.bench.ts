import { baseline } from "./baseline.js";
import * as o from "ovr";
import { bench, describe, expect } from "vitest";

// the closure-based schema, before definitions
const { Schema: Before }: { Schema: typeof o.Schema } = await import(
	baseline("schema", {}, "67ad093afcea7a60adbb1637cb96197b1e88666b")
);

function row(Schema: typeof o.Schema) {
	return Schema.object({
		id: Schema.string(),
		email: Schema.string().email(),
		name: Schema.string().nullable(),
		age: Schema.number().int().min(0),
		visits: Schema.bigint(),
		active: Schema.boolean(),
		tags: Schema.array(Schema.string()),
	});
}

const before = row(Before);
const after = row(o.Schema);
const valid = {
	id: "user-1",
	email: "user@example.com",
	name: null,
	age: 30,
	visits: 12n,
	active: true,
	tags: ["a", "b"],
};
const invalid = { ...valid, email: "nope", age: -1 };
const rows = Array.from({ length: 100 }, (_, i) => ({ ...valid, age: i }));
const options = { time: 2000, warmupTime: 1000, setup: () => global.gc?.() };

expect(after.parse(valid)).toEqual(before.parse(valid));
expect(after.parse(invalid).issues?.map((issue) => issue.path)).toEqual(
	before.parse(invalid).issues?.map((issue) => issue.path),
);

describe("schema parse", () => {
	bench(
		"valid row before definitions",
		() => {
			before.parse(valid);
		},
		options,
	);
	bench(
		"valid row",
		() => {
			after.parse(valid);
		},
		options,
	);

	bench(
		"100 valid rows before definitions",
		() => {
			for (const value of rows) before.parse(value);
		},
		options,
	);
	bench(
		"100 valid rows",
		() => {
			for (const value of rows) after.parse(value);
		},
		options,
	);

	bench(
		"invalid row before definitions",
		() => {
			before.parse(invalid);
		},
		options,
	);
	bench(
		"invalid row",
		() => {
			after.parse(invalid);
		},
		options,
	);
});

const union = o.Schema.union([
	o.Schema.object({ type: o.Schema.literal("a"), value: o.Schema.number() }),
	o.Schema.object({ type: o.Schema.literal("b"), value: o.Schema.number() }),
	o.Schema.object({ type: o.Schema.literal("c"), value: o.Schema.string() }),
]);
const nested = o.Schema.array(
	o.Schema.object({
		items: o.Schema.array(
			o.Schema.object({ quantity: o.Schema.number().int() }),
		),
	}),
);
const deep = Array.from({ length: 20 }, () => ({
	items: Array.from({ length: 10 }, () => ({ quantity: 1.5 })),
}));

expect(union.parse({ type: "c", value: "x" }).data).toEqual({
	type: "c",
	value: "x",
});
expect(nested.parse(deep).issues).toHaveLength(200);

describe("schema branches", () => {
	bench(
		"valid union matching its last branch",
		() => {
			union.parse({ type: "c", value: "x" });
		},
		options,
	);

	bench(
		"deeply nested invalid input, 200 issues",
		() => {
			nested.parse(deep);
		},
		options,
	);
});

describe("schema JSON Schema", () => {
	bench(
		"toJsonSchema",
		() => {
			after.toJsonSchema();
		},
		options,
	);
});
