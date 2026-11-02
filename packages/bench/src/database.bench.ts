import * as o from "ovr";
import { bench, describe, expect } from "vitest";

const options = { time: 2000, warmupTime: 1000, setup: () => global.gc?.() };

const events = new o.Table("events", {
	id: o.Schema.bigint(),
	amount: o.Schema.number(),
	name: o.Schema.string(),
	active: o.Schema.boolean(),
	created: o.Schema.date(),
	payload: o.Schema.object({
		kind: o.Schema.string(),
		tags: o.Schema.array(o.Schema.string()),
		items: o.Schema.array(
			o.Schema.object({ sku: o.Schema.string(), quantity: o.Schema.number() }),
		),
	}),
});

// pg returns int8 and numeric as strings, and parses JSON and timestamps
const fields = [
	{ name: "id", dataTypeID: 20 },
	{ name: "amount", dataTypeID: 1700 },
	{ name: "name", dataTypeID: 25 },
	{ name: "active", dataTypeID: 16 },
	{ name: "created", dataTypeID: 1184 },
	{ name: "payload", dataTypeID: 3802 },
];
const created = new Date();
const rows = Array.from({ length: 1000 }, (_, i) => ({
	id: String(i),
	amount: "12.5",
	name: `event ${i}`,
	active: true,
	created,
	payload: {
		kind: "order",
		tags: ["a", "b", "c"],
		items: Array.from({ length: 20 }, (_, j) => ({
			sku: `sku-${j}`,
			quantity: j,
		})),
	},
}));

const db = new o.Database(
	{
		query: async () => ({ rows, fields }),
		connect: () => {
			throw new Error("unused");
		},
	},
	[events],
);

const inserts = rows.map((row, i) => ({
	id: BigInt(i),
	amount: 12.5,
	name: row.name,
	active: true,
	created,
	payload: row.payload,
}));

expect(
	(await db.sql`SELECT * FROM ${db.events}`.parse(db.events))[0],
).toMatchObject({ id: 0n, amount: 12.5, created });
expect(db.sql.values(db.events, inserts).toQuery().values).toHaveLength(6000);

describe("database rows", () => {
	bench(
		"decode and parse 1000 rows with JSON",
		async () => {
			await db.sql`SELECT * FROM ${db.events}`.parse(db.events);
		},
		options,
	);

	bench(
		"build a 1000 row insert",
		() => {
			db.sql.values(db.events, inserts).toQuery();
		},
		options,
	);
});
