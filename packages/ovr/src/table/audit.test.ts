import { Schema } from "../schema/index.js";
import { Table } from "./index.js";
import { describe, expect, test } from "vitest";

describe("table audit regressions", () => {
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
});
