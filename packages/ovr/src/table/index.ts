import { Schema } from "../schema/index.js";

export namespace Table {
	/** Column schemas keyed by column name. */
	export type Shape = Schema.Object.Shape;

	/** Column name of a shape. */
	export type Key<S extends Shape> = Extract<keyof S, string>;

	/** Postgres schema and the columns the database supplies. */
	export interface Options<S extends Shape = Shape> {
		/** Schema containing the table, defaults to the connection's search path. */
		readonly schema?: string;

		/**
		 * Columns that may be omitted on insert because the database supplies a
		 * value, with a `DEFAULT`, identity, or generated column.
		 */
		readonly default?: readonly Key<S>[];
	}

	/** Any table. */
	export type Any = Table<string, any, any>;

	/** Row returned from the table. */
	export type Row<S extends Shape> = { [K in keyof S]: Schema.Infer<S[K]> };

	/** Column names that may be omitted from an insert: nullable or supplied by the database. */
	export type Defaulted<S extends Shape, O extends Options<S>> =
		| Extract<NonNullable<O["default"]>[number], Key<S>>
		| {
				[K in Key<S>]: unknown extends Schema.Infer<S[K]>
					? never // unknown columns store JSON null, so they are NOT NULL
					: null extends Schema.Infer<S[K]>
						? K
						: never;
		  }[Key<S>];

	/** Values accepted by `sql.values` for one row. */
	export type Insert<S extends Shape, O extends Options<S>> = {
		[K in Exclude<Key<S>, Defaulted<S, O>>]: Schema.Infer<S[K]>;
	} & { [K in Defaulted<S, O>]?: Schema.Infer<S[K]> };

	/** Values accepted by `sql.set`. */
	export type Update<S extends Shape> = Partial<Row<S>>;

	/** Kind of value a column stores, each compatible with several Postgres types. */
	export type Type =
		"string" | "number" | "bigint" | "boolean" | "date" | "json";
}

/** Reference to one column, interpolated by `sql` as a qualified identifier. */
export class Column {
	/** Table containing the column. */
	readonly table: Table.Any;

	/** Column name. */
	readonly name: string;

	/** Kind of value derived from the column schema. */
	readonly type: Table.Type;

	/** If the column allows `NULL`. */
	readonly nullable: boolean;

	/**
	 * @param table Table containing the column
	 * @param name Column name
	 * @param type Kind of value
	 * @param nullable If the column allows `NULL`
	 */
	constructor(
		table: Table.Any,
		name: string,
		type: Table.Type,
		nullable: boolean,
	) {
		this.table = table;
		this.name = name;
		this.type = type;
		this.nullable = nullable;
	}
}

/**
 * Postgres table defined with validation schemas.
 *
 * The table is a schema of its rows, so `Schema.Infer<typeof table>` is the
 * row type and `sql.parse(table)` validates returned rows. Keys, constraints, and
 * indexes belong in migrations.
 *
 * @template Name Table name
 * @template S Column schemas
 * @template O Table options
 */
export class Table<
	Name extends string,
	S extends Table.Shape,
	const O extends Table.Options<S> = {},
> extends Schema<Table.Row<S>> {
	/** Table name. */
	readonly name: Name;

	/** Column schemas. */
	readonly shape: S;

	/** Postgres schema and the columns the database supplies. */
	readonly options: O;

	/** Column references for `sql`. */
	readonly columns: { readonly [K in keyof S]: Column };

	/**
	 * Define a table.
	 *
	 * @param name Table name
	 * @param shape Column schemas
	 * @param options Postgres schema and the columns the database supplies
	 */
	constructor(name: Name, shape: S, options = {} as O) {
		super({ type: "object", shape, mode: "strip" });

		if (!name) throw new TypeError("Table name is required");

		this.name = name;
		this.shape = shape;
		this.options = options;

		const columns: Record<string, Column> = {};

		for (const [key, schema] of Object.entries(shape)) {
			const [type, nullable] = Table.#type(schema.def, `${name}.${key}`);

			columns[key] = new Column(this, key, type, nullable);
		}

		for (const key of options.default ?? []) {
			if (!Object.hasOwn(shape, key))
				throw new TypeError(`Table ${name}: unknown column ${key}`);
		}

		this.columns = columns as { readonly [K in keyof S]: Column };
	}

	/**
	 * Map a column definition to the kind of value it stores.
	 *
	 * @param def Column schema definition
	 * @param column Column label for errors
	 * @returns Kind of value and nullability
	 */
	static #type(
		def: Schema.Def,
		column: string,
	): [type: Table.Type, nullable: boolean] {
		switch (def.type) {
			case "string":
			case "boolean":
			case "number":
			case "bigint":
			case "date":
				return [def.type, false];
			case "unknown":
			case "object":
			case "array":
				Table.#json(def, column);

				return ["json", false];
			case "literal":
			case "enum": {
				const kinds = new Set(
					(def.type === "literal" ? [def.value] : def.values).map(
						(value) => typeof value,
					),
				);
				const [kind] = kinds;

				if (
					kinds.size === 1 &&
					(kind === "string" || kind === "boolean" || kind === "number")
				)
					return [kind, false];

				break;
			}
			case "nullable":
				return [Table.#type(def.inner.def, column)[0], true];
			case "check":
			// form fields normalize their input, a stored value parses unchanged
			case "preprocess":
				return Table.#type(def.inner.def, column);
			case "json":
				throw new TypeError(
					`Table ${column}: use the parsed object or array schema for JSON instead of json()`,
				);
			case "optional":
			case "nullish":
			case "default":
				throw new TypeError(
					`Table ${column}: use nullable() or the default option instead of ${def.type}()`,
				);
		}

		throw new TypeError(
			`Table ${column}: ${def.type} schemas cannot be stored as a column`,
		);
	}

	/**
	 * Ensure values stored as JSON parse again when read.
	 *
	 * @param def Schema definition inside a JSON column
	 * @param column Column label for errors
	 */
	static #json(def: Schema.Def, column: string): void {
		switch (def.type) {
			case "unknown":
			case "string":
			case "boolean":
			case "number":
				return;
			case "literal":
			case "enum":
				if (
					(def.type === "literal" ? [def.value] : def.values).every(
						(value) =>
							value === null ||
							["string", "number", "boolean", "undefined"].includes(
								typeof value,
							),
					)
				)
					return;

				break;
			case "array": {
				const empty = def.item.parse(undefined);

				// JSON stores undefined items as null, which must parse again
				if (
					!empty.issues &&
					empty.data === undefined &&
					def.item.parse(null).issues
				)
					throw new TypeError(
						`Table ${column}: JSON stores undefined array items as null, allow null instead of undefined`,
					);

				return Table.#json(def.item.def, column);
			}
			case "object":
				for (const schema of Object.values(def.shape)) {
					Table.#json(schema.def, column);
				}

				return;
			case "union":
				for (const schema of def.options) {
					Table.#json(schema.def, column);
				}

				return;
			case "pipe":
				Table.#json(def.inner.def, column);

				return Table.#json(def.next.def, column);
			case "optional":
			case "nullable":
			case "nullish":
			case "default":
			case "check":
				return Table.#json(def.inner.def, column);
		}

		throw new TypeError(
			`Table ${column}: ${def.type} schemas cannot be stored in JSON`,
		);
	}
}
