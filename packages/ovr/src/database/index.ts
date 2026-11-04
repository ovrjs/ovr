import { Schema } from "../schema/index.js";
import { Column, Table } from "../table/index.js";

export namespace Database {
	/** Query capability of a pg-compatible client. */
	export interface Client {
		query(text: string, values?: unknown[]): Promise<Result>;
	}

	/** Query result of a pg-compatible client. */
	export interface Result {
		readonly rows: unknown[];

		/** Returned columns, used to decode `int8`, `numeric`, and JSON values. */
		readonly fields?: readonly Field[];
	}

	/** Returned column with its Postgres type ID. */
	export interface Field {
		readonly name: string;
		readonly dataTypeID: number;
	}

	/** pg-compatible pool; `connect` checks out one client for a transaction. */
	export interface Pool extends Client {
		connect(): Promise<Client & { release(error?: Error | boolean): void }>;
	}

	/** SQL migration applied by `migrate`. */
	export interface Migration {
		/** Unique ID, migrations are applied in ID order. */
		readonly id: string;

		/** Trusted SQL, may contain several statements. */
		readonly sql: string;
	}

	/** Tables accessible by name on the database, none when names are unknown so any database is a `Database`. */
	export type Tables<T extends readonly Table.Any[]> =
		string extends T[number]["name"]
			? {}
			: { readonly [K in T[number] as K["name"]]: K };

	/** Names used by database members, tables cannot use them. */
	export type Reserved = "sql" | "transaction" | "migrate" | "check";

	/** Tables with reserved names are rejected. */
	export type Valid<T extends readonly Table.Any[]> = {
		readonly [I in keyof T]: T[I] extends { name: Reserved } ? never : T[I];
	};

	/** SQL template tag and helpers bound to a pool or transaction. */
	export interface Tag {
		/**
		 * Build a query, run when awaited.
		 *
		 * Tables and columns become quoted identifiers, nested fragments are
		 * inlined, and every other value becomes a bound parameter.
		 */
		(strings: TemplateStringsArray, ...values: unknown[]): Sql;

		/**
		 * Validate rows and build the `(columns) VALUES (...)` of an insert.
		 * Omitted columns use their SQL default.
		 *
		 * @param table Table to insert into
		 * @param rows One row or several, an empty list throws
		 * @returns Columns and values
		 */
		values<T extends Table.Any>(
			table: T,
			rows: Insert<T> | readonly Insert<T>[],
		): Sql;

		/**
		 * Validate values and build the assignments of an update.
		 *
		 * @param table Table to update
		 * @param values Columns to change
		 * @returns Assignments
		 */
		set<T extends Table.Any>(table: T, values: Update<T>): Sql;
	}

	/** Insert values of a table. */
	export type Insert<T extends Table.Any> =
		T extends Table<string, infer S, infer O> ? Table.Insert<S, O> : never;

	/** Update values of a table. */
	export type Update<T extends Table.Any> =
		T extends Table<string, infer S, any> ? Table.Update<S> : never;

	/** Scope passed to `transaction`. */
	export interface Transaction {
		/** SQL tag that runs on the transaction's connection. */
		readonly sql: Tag;
	}
}

/** Identifier quoting shared by `Sql` and `Database`, not exported. */
class Identifier {
	/**
	 * @param name Identifier
	 * @returns Quoted identifier
	 */
	static quote(name: string) {
		if (!name || name.includes("\0"))
			throw new TypeError(`Invalid SQL identifier: ${JSON.stringify(name)}`);

		return `"${name.replaceAll('"', '""')}"`;
	}

	/**
	 * @param table Table
	 * @returns Quoted, schema-qualified table name
	 */
	static table(table: Table.Any) {
		return (
			(table.options.schema
				? `${Identifier.quote(table.options.schema)}.`
				: "") + Identifier.quote(table.name)
		);
	}
}

/** Converts one driver value. */
type Convert = (value: unknown) => unknown;

/**
 * SQL fragment, a lazy promise that runs once on its client when awaited.
 *
 * @template Row Row type
 */
export class Sql<Row = unknown> implements Promise<Row[]> {
	/** Text segments surrounding the values. */
	readonly #strings: readonly string[];

	/** Interpolated values. */
	readonly #values: readonly unknown[];

	/** Client used when awaited. */
	readonly #client: Database.Client;

	/** Schema validating each returned row. */
	readonly #schema: Schema<Row> | undefined;

	/** Query result, shared with the fragments `parse` returns so the query runs once. */
	readonly #execution: { result?: Promise<Database.Result> };

	/** Validated rows, started by the first `then`, `catch`, or `finally`. */
	#result?: Promise<Row[]>;

	readonly [Symbol.toStringTag] = "Sql";

	/**
	 * @param strings Text segments, one more than values
	 * @param values Interpolated values
	 * @param client Client used when awaited
	 * @param schema Schema validating each returned row
	 * @param execution Query result shared with the source fragment
	 */
	constructor(
		strings: readonly string[],
		values: readonly unknown[],
		client: Database.Client,
		schema?: Schema<Row>,
		execution: { result?: Promise<Database.Result> } = {},
	) {
		this.#strings = strings;
		this.#values = values;
		this.#client = client;
		this.#schema = schema;
		this.#execution = execution;
	}

	/**
	 * Parse each returned row with a schema, throwing the issues if any fail.
	 * The query still runs once, however many fragments `parse` returns.
	 *
	 * @template O Row type
	 * @param schema Row schema, for example a table
	 * @returns Fragment returning parsed rows
	 */
	parse<O>(schema: Schema<O>) {
		return new Sql<O>(
			this.#strings,
			this.#values,
			this.#client,
			schema,
			this.#execution,
		);
	}

	/**
	 * Compile to parameterized text.
	 *
	 * @returns Query text and parameter values
	 */
	toQuery() {
		const values: unknown[] = [];

		return { text: this.#build(values), values };
	}

	/**
	 * Run the query once, the first time the result is requested.
	 *
	 * @param resolve Receives the rows
	 * @param reject Receives the query or validation error
	 * @returns Promise of the callback result
	 */
	then<A = Row[], B = never>(
		resolve?: ((rows: Row[]) => A | PromiseLike<A>) | null,
		reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
	) {
		return (this.#result ??= this.#run()).then(resolve, reject);
	}

	/**
	 * @param reject Receives the query or validation error
	 * @returns Promise of the rows or the callback result
	 */
	catch<B = never>(reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
		return this.then(undefined, reject);
	}

	/**
	 * @param fn Called when the query settles
	 * @returns Promise of the rows
	 */
	finally(fn?: (() => void) | null) {
		return this.then().finally(fn);
	}

	async #run() {
		if (!this.#execution.result) {
			const { text, values } = this.toQuery();

			this.#execution.result = this.#client.query(text, values);
		}

		const { rows, fields } = await this.#execution.result;

		if (!this.#schema) return rows as Row[];

		const base = Sql.#base(this.#schema.def);
		const decode =
			base.type === "object" && fields
				? Sql.#decoder(base.shape, fields)
				: undefined;
		const data: Row[] = [];
		const issues: Schema.Issue[] = [];

		for (let i = 0; i < rows.length; i++) {
			const result = this.#schema.parse(decode ? decode(rows[i]) : rows[i], [
				i,
			]);

			if (result.issues) issues.push(...result.issues);
			else data.push(result.data);
		}

		if (issues.length) throw new Schema.AggregateIssue(issues);

		return data;
	}

	/**
	 * @param values Parameter values, appended to
	 * @returns Query text using `$n` placeholders
	 */
	#build(values: unknown[]): string {
		let text = this.#strings[0]!;

		for (let i = 0; i < this.#values.length; i++) {
			const value = this.#values[i];

			text +=
				(value instanceof Sql
					? value.#build(values)
					: value instanceof Table
						? Identifier.table(value)
						: value instanceof Column
							? `${Identifier.table(value.table)}.${Identifier.quote(value.name)}`
							: `$${values.push(typeof value === "bigint" ? String(value) : value)}`) +
				this.#strings[i + 1];
		}

		return text;
	}

	/**
	 * @param def Schema definition
	 * @returns Definition that validates the input, without modifiers
	 */
	static #base(def: Schema.Def): Schema.Def {
		switch (def.type) {
			case "optional":
			case "nullable":
			case "nullish":
			case "default":
			case "check":
			case "pipe":
			case "transform":
				return Sql.#base(def.inner.def);
		}

		return def;
	}

	/**
	 * Build the row decoder for one result, converting driver values into the
	 * types the row schema expects by each column's Postgres type.
	 *
	 * @param shape Row schema shape
	 * @param fields Returned columns
	 * @returns Decoder, or `undefined` when no column needs converting
	 */
	static #decoder(
		shape: Schema.Object.Shape,
		fields: readonly Database.Field[],
	) {
		const columns: [name: string, convert: Convert][] = [];

		for (const { name, dataTypeID } of fields) {
			if (!Object.hasOwn(shape, name)) continue;

			const def = shape[name]!.def;
			let convert: Convert | undefined;

			switch (dataTypeID) {
				case 20: // int8
				case 1700: // numeric
					convert = Sql.#number(def);
					break;
				case 1016: // int8[]
				case 1231: // numeric[]
					convert = Sql.#numbers(def);
					break;
				case 114: // json
				case 3802: // jsonb
				case 199: // json[]
				case 3807: // jsonb[]
					convert = Sql.#dates(def);
			}

			if (convert) columns.push([name, convert]);
		}

		if (!columns.length) return;

		return (row: unknown) => {
			if (row == null || typeof row !== "object") return row;

			// the driver's row is not modified, it may be shared with other views
			const decoded: Record<string, unknown> = { ...row };

			for (const [name, convert] of columns) {
				decoded[name] = convert(decoded[name]);
			}

			return decoded;
		};
	}

	/**
	 * @param def Schema definition
	 * @returns Converter for a Postgres array, possibly multidimensional
	 */
	static #numbers(def: Schema.Def): Convert | undefined {
		const base = Sql.#base(def);

		if (base.type !== "array") return Sql.#number(def);

		const item = Sql.#numbers(base.item.def);

		return (
			item && ((value) => (Array.isArray(value) ? value.map(item) : value))
		);
	}

	/**
	 * Drivers return `int8` and `numeric` as strings or bigints, and pg
	 * returns `numeric[]` items as numbers.
	 *
	 * @param def Schema definition
	 * @returns Converter to a bigint or number, integers are never rounded
	 */
	static #number(def: Schema.Def): Convert | undefined {
		const base = Sql.#base(def);

		// numbers beyond 2^53 were already rounded by the driver
		if (base.type === "bigint")
			return (value) =>
				(typeof value === "string" && /^-?\d+$/.test(value)) ||
				Number.isSafeInteger(value)
					? BigInt(value as string | number)
					: value;

		if (base.type !== "number") return;

		return (value) => {
			if (
				typeof value !== "string" &&
				typeof value !== "bigint" &&
				typeof value !== "number"
			)
				return value;

			const number = Number(value);

			// integers beyond 2^53 may already be rounded, a string fails validation
			return Number.isInteger(number) && !Number.isSafeInteger(number)
				? String(value)
				: number;
		};
	}

	/**
	 * JSON has no dates, so they are returned as ISO strings.
	 *
	 * @param def Schema definition
	 * @returns Converter for the branches containing dates, `undefined` without any
	 */
	static #dates(def: Schema.Def): Convert | undefined {
		const base = Sql.#base(def);

		switch (base.type) {
			case "date":
				return (value) => (typeof value === "string" ? new Date(value) : value);
			case "array": {
				const item = Sql.#dates(base.item.def);

				return (
					item && ((value) => (Array.isArray(value) ? value.map(item) : value))
				);
			}
			case "object": {
				const keys: [key: string, convert: Convert][] = [];

				for (const [key, schema] of Object.entries(base.shape)) {
					const convert = Sql.#dates(schema.def);

					if (convert) keys.push([key, convert]);
				}

				if (!keys.length) return;

				return (value) => {
					if (
						value == null ||
						typeof value !== "object" ||
						Array.isArray(value)
					)
						return value;

					const decoded: Record<string, unknown> = { ...value };

					for (const [key, convert] of keys) {
						if (Object.hasOwn(decoded, key))
							decoded[key] = convert(decoded[key]);
					}

					return decoded;
				};
			}
		}
	}
}

/**
 * Migrations a library's tables bring, by table. Tables of one library share
 * one list, applied by `database.migrate` in its own ID order before the application's.
 */
export const owned = new WeakMap<Table.Any, readonly Database.Migration[]>();

/** Database members, tables are added by name. */
class Base<T extends readonly Table.Any[]> {
	/** Names database members use. */
	static readonly #reserved = new Set([
		"sql",
		"transaction",
		"migrate",
		"check",
	]);

	/** Postgres types able to store each kind of column value, preferred first. */
	static readonly #types: Record<Table.Type, readonly string[]> = {
		string: [
			"text",
			"character varying",
			"character",
			"citext",
			"uuid",
			"enum",
		],
		number: [
			"double precision",
			"integer",
			"bigint",
			"numeric",
			"real",
			"smallint",
		],
		bigint: ["bigint", "numeric"],
		boolean: ["boolean"],
		date: ["timestamp with time zone", "timestamp without time zone", "date"],
		json: ["jsonb", "json"],
	};

	/** Insert and update schemas by table. */
	static readonly #writes = new WeakMap<
		Table.Any,
		{
			insert: Schema<Record<string, unknown>>;
			update: Schema<Record<string, unknown>>;
		}
	>();

	readonly #pool: Database.Pool;
	readonly #tables: T;

	/** SQL tag, queries run on the pool when awaited. */
	readonly sql: Database.Tag;

	/**
	 * @param pool pg-compatible pool, owned by the application
	 * @param tables Tables, accessible by name
	 */
	constructor(pool: Database.Pool, tables: T) {
		this.#pool = pool;
		this.#tables = tables;
		this.sql = Base.#tag(pool);

		for (const table of tables) {
			if (Base.#reserved.has(table.name) || Object.hasOwn(this, table.name))
				throw new TypeError(
					`Database table name ${table.name} is not available`,
				);

			Object.defineProperty(this, table.name, {
				value: table,
				enumerable: true,
			});
		}
	}

	/**
	 * Run a callback in a transaction on one connection.
	 *
	 * Commits when the callback resolves and rolls back when it throws.
	 *
	 * @template R Callback result
	 * @param fn Callback, query with `t.sql`
	 * @returns Callback result
	 */
	readonly transaction = <R>(fn: (t: Database.Transaction) => Promise<R>) =>
		this.#transaction((client) => fn({ sql: Base.#tag(client) }));

	/**
	 * @template R Callback result
	 * @param fn Callback receiving the transaction's client
	 * @returns Callback result
	 */
	async #transaction<R>(fn: (client: Database.Client) => Promise<R>) {
		const connection = await this.#pool.connect();
		let open = true;
		let failure: unknown;
		let broken: Error | undefined;

		// only valid until the transaction ends, the connection returns to the pool
		const client: Database.Client = {
			query: async (text, values) => {
				if (!open) throw new Error("Transaction has ended");

				try {
					return await connection.query(text, values);
				} catch (error) {
					// queries after an aborted statement fail too, keep the cause
					if ((error as { code?: unknown } | null)?.code !== "25P02")
						failure = error;

					throw error;
				}
			},
		};

		try {
			await connection.query("BEGIN");
			const result = await fn(client).finally(() => (open = false));

			// COMMIT of an aborted transaction rolls back without an error
			if (failure !== undefined)
				await connection.query("SELECT 1").catch(() => {
					throw failure;
				});

			await connection.query("COMMIT");

			return result;
		} catch (error) {
			open = false;
			await connection.query("ROLLBACK").catch((reason: unknown) => {
				broken = reason instanceof Error ? reason : new Error(String(reason));
			});

			throw error;
		} finally {
			// a connection that cannot roll back is destroyed instead of reused
			connection.release(broken);
		}
	}

	/**
	 * Apply pending migrations in ID order. Libraries' tables, such as
	 * `Auth.tables`, bring their own migrations, applied first in their own
	 * order, so a migration of yours can reference their tables.
	 *
	 * Each migration and its history record commit together while holding a
	 * transaction-level advisory lock, so concurrent runs apply each once.
	 *
	 * @param migrations Every migration of yours, including applied ones
	 * @returns IDs applied by this call
	 */
	readonly migrate = async (migrations: readonly Database.Migration[]) => {
		// each library's migrations, in the order their tables are listed, then yours
		const groups = [
			...new Set(this.#tables.map((table) => owned.get(table))),
		].filter((group) => group !== undefined);
		groups.push(migrations);

		const checksums = new Map<string, string>();

		for (const { id, sql } of groups.flat()) {
			if (!id || checksums.has(id))
				throw new TypeError(`Invalid or duplicate migration ID: ${id}`);

			checksums.set(
				id,
				new Uint8Array(
					await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql)),
				).toHex(),
			);
		}

		const sorted = groups.map((group) =>
			[...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		);
		const applied: string[] = [];
		const done = new Set<string>();
		let last = 0;

		// one migration per transaction, history added since the last read is verified every time
		while (
			await this.#transaction(async (client) => {
				const sql = Base.#tag(client);

				await sql`SELECT pg_advisory_xact_lock(hashtext('migrations'))`;
				// applied in order under the lock, so `n` follows the history
				await sql`CREATE TABLE IF NOT EXISTS migrations (n bigint GENERATED ALWAYS AS IDENTITY, id text PRIMARY KEY, checksum text NOT NULL, applied timestamptz NOT NULL DEFAULT now())`;

				const history = await sql`
					SELECT n, id, checksum FROM migrations WHERE n > ${last} ORDER BY n
				`.parse(
					Schema.object({
						n: Schema.number().int(),
						id: Schema.string(),
						checksum: Schema.string(),
					}),
				);

				for (const row of history) {
					if (!checksums.has(row.id))
						throw new Error(`Applied migration ${row.id} is missing`);
					if (checksums.get(row.id) !== row.checksum)
						throw new Error(`Applied migration ${row.id} has changed`);

					done.add(row.id);
					last = row.n;
				}

				for (const group of sorted) {
					const next = group.find((migration) => !done.has(migration.id));
					if (!next) continue;

					const later = group.findLast((migration) => done.has(migration.id));
					if (later && later.id > next.id)
						throw new Error(
							`Migration ${next.id} sorts before applied migration ${later.id}`,
						);

					await new Sql([next.sql], [], client);
					const [row] = await sql`
						INSERT INTO migrations (id, checksum) VALUES (${next.id}, ${checksums.get(next.id)})
						RETURNING n
					`.parse(Schema.object({ n: Schema.number().int() }));
					applied.push(next.id);
					done.add(next.id);
					last = row!.n;

					return true;
				}

				return false;
			})
		);

		return applied;
	};

	/**
	 * Check that the live database can store and return the tables' rows.
	 *
	 * Reports missing tables and columns, incompatible types, nullability, and
	 * missing defaults, without changing anything. Keys, constraints, and indexes
	 * are left to migrations.
	 *
	 * @returns One line per difference, empty when they match
	 */
	readonly check = async () => {
		const differences: string[] = [];

		for (const table of this.#tables) {
			const label = table.name;
			const [{ regclass } = { regclass: null }] = await this
				.sql`SELECT to_regclass(${Identifier.table(table)})::text AS regclass`.parse(
				Schema.object({ regclass: Schema.string().nullable() }),
			);

			if (!regclass) {
				differences.push(`${label}: missing table`);
				continue;
			}

			// each column's type and the domains it is built on, which may add NOT NULL and defaults
			const columns = await this.sql`
				WITH RECURSIVE chain AS (
					SELECT a.attnum, t.oid, t.typtype, t.typbasetype, t.typnotnull, t.typdefaultbin IS NOT NULL AS "default"
					FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
					WHERE a.attrelid = to_regclass(${regclass}) AND a.attnum > 0 AND NOT a.attisdropped
					UNION ALL
					SELECT c.attnum, t.oid, t.typtype, t.typbasetype, t.typnotnull, t.typdefaultbin IS NOT NULL
					FROM chain c JOIN pg_type t ON t.oid = c.typbasetype
					WHERE c.typtype = 'd'
				)
				SELECT a.attname::text AS name,
					-- domains compare as their base type, enums as "enum"
					(SELECT CASE WHEN c.typtype = 'e' THEN 'enum' ELSE format_type(c.oid, NULL) END
						FROM chain c WHERE c.attnum = a.attnum AND c.typtype <> 'd') AS type,
					NOT (a.attnotnull OR EXISTS (SELECT 1 FROM chain c WHERE c.attnum = a.attnum AND c.typnotnull)) AS nullable,
					a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> ''
						OR EXISTS (SELECT 1 FROM chain c WHERE c.attnum = a.attnum AND c."default") AS "default"
				FROM pg_attribute a
				WHERE a.attrelid = to_regclass(${regclass}) AND a.attnum > 0 AND NOT a.attisdropped
			`.parse(
				Schema.object({
					name: Schema.string(),
					type: Schema.string(),
					nullable: Schema.boolean(),
					default: Schema.boolean(),
				}),
			);
			const found = new Map(columns.map((column) => [column.name, column]));
			const defaults = new Set<string>(table.options.default ?? []);

			for (const column of Object.values<Column>(table.columns)) {
				const actual = found.get(column.name);
				const types = Base.#types[column.type];
				const nullable = (value: boolean) => (value ? "NULL" : "NOT NULL");

				if (!actual) {
					differences.push(
						`${label}.${column.name}: missing column (${types[0]} ${nullable(column.nullable)})`,
					);
					continue;
				}

				if (!types.includes(actual.type))
					differences.push(
						`${label}.${column.name}: ${actual.type} cannot store ${column.type} values, use ${types.join(", ")}`,
					);
				if (actual.nullable !== column.nullable)
					differences.push(
						`${label}.${column.name}: expected ${nullable(column.nullable)}, found ${nullable(actual.nullable)}`,
					);
				if (defaults.has(column.name) && !actual.default)
					differences.push(`${label}.${column.name}: missing default`);
			}

			// other columns are fine unless inserts cannot omit them
			for (const column of columns) {
				if (
					!Object.hasOwn(table.columns, column.name) &&
					!column.nullable &&
					!column.default
				)
					differences.push(
						`${label}.${column.name}: unexpected NOT NULL column without a default`,
					);
			}
		}

		return differences;
	};

	/**
	 * @param table Table
	 * @returns Cached insert and update schemas
	 */
	static #write(table: Table.Any) {
		let write = Base.#writes.get(table);

		if (!write) {
			const insert: Schema.Object.Shape = {};
			const update: Schema.Object.Shape = {};
			const defaults = new Set<string>(table.options.default ?? []);

			for (const [key, schema] of Object.entries<Schema<unknown>>(
				table.shape,
			)) {
				// a schema accepting undefined, like unknown, cannot tell an omitted column
				insert[key] =
					defaults.has(key) ||
					(table.columns[key]!.nullable && schema.parse(undefined).issues)
						? schema.optional()
						: schema.refine((value) => value !== undefined, "Required");
				update[key] = schema.optional();
			}

			write = {
				insert: Schema.object(insert).strict(),
				update: Schema.object(update).strict(),
			};
			Base.#writes.set(table, write);
		}

		return write;
	}

	/**
	 * @param schema Write schema
	 * @param value Values to validate
	 * @param path Issue path
	 * @returns Validated values
	 */
	static #parse(
		schema: Schema<Record<string, unknown>>,
		value: unknown,
		path: Schema.Issue.Path = [],
	) {
		const result = schema.parse(value, path);

		if (result.issues) throw result;

		return result.data;
	}

	/**
	 * @param column Column receiving the value
	 * @param value Validated value
	 * @returns Driver parameter
	 */
	static #encode(column: Column, value: unknown) {
		// drivers send arrays as Postgres arrays, so JSON is always serialized,
		// and null is SQL NULL only when the column allows it
		return column.type === "json" && (value !== null || !column.nullable)
			? JSON.stringify(value)
			: value;
	}

	/**
	 * @param client Client queries run on
	 * @returns SQL tag bound to the client
	 */
	static #tag(client: Database.Client): Database.Tag {
		const fragment = (strings: readonly string[], values: readonly unknown[]) =>
			new Sql(strings, values, client);
		const raw = (text: string) => fragment([text], []);

		return Object.assign(
			(strings: TemplateStringsArray, ...values: unknown[]) =>
				fragment(strings, values),
			{
				values: (table: Table.Any, rows: unknown) => {
					const list = (Array.isArray(rows) ? rows : [rows]).map((row, i) =>
						Base.#parse(
							Base.#write(table).insert,
							row,
							Array.isArray(rows) ? [i] : [],
						),
					);
					const keys = Object.keys(table.columns).filter((key) =>
						list.some((row) => Object.hasOwn(row, key)),
					);

					if (!list.length) throw new TypeError("sql.values requires a row");
					if (!keys.length) {
						if (list.length > 1)
							throw new TypeError("sql.values requires a column");

						return raw("DEFAULT VALUES");
					}

					// one fragment for every row, text is added to the segment before the next value
					const strings = [
						`(${keys.map(Identifier.quote).join(", ")}) VALUES `,
					];
					const params: unknown[] = [];

					for (let r = 0; r < list.length; r++) {
						const row = list[r]!;
						let text = r ? ", (" : "(";

						for (let k = 0; k < keys.length; k++) {
							const key = keys[k]!;

							if (k) text += ", ";

							if (Object.hasOwn(row, key)) {
								strings[strings.length - 1] += text;
								strings.push("");
								params.push(Base.#encode(table.columns[key]!, row[key]));
								text = "";
							} else {
								text += "DEFAULT";
							}
						}

						strings[strings.length - 1] += text + ")";
					}

					return fragment(strings, params);
				},
				set: (table: Table.Any, values: unknown) => {
					const data = Base.#parse(Base.#write(table).update, values);
					const keys = Object.keys(data);

					if (!keys.length) throw new TypeError("sql.set requires a column");

					return fragment(
						[
							...keys.map(
								(key, i) => `${i ? ", " : ""}${Identifier.quote(key)} = `,
							),
							"",
						],
						keys.map((key) => Base.#encode(table.columns[key]!, data[key])),
					);
				},
			},
		) as Database.Tag;
	}

	/**
	 * Check whether an error is a unique constraint violation, for example to
	 * show it as a form error.
	 *
	 * ```ts
	 * if (Database.unique(error, "users_email_key")) {
	 * 	const invalid = result.invalid({ email: "Already registered" });
	 * 	return c.redirect(invalid.url, 303);
	 * }
	 * ```
	 *
	 * @param error Caught error
	 * @param constraint Constraint name, any unique constraint when omitted
	 * @returns `true` for a matching unique violation
	 */
	static unique(error: unknown, constraint?: string) {
		if (!(error instanceof Error)) return false;

		const { code, constraint: name } = error as {
			code?: unknown;
			constraint?: unknown;
		};

		// SQLSTATE unique_violation
		return (
			code === "23505" && (constraint === undefined || name === constraint)
		);
	}
}

/**
 * Postgres database with tables, accessed through an application-owned,
 * pg-compatible pool.
 *
 * ```ts
 * const database = new Database(pool, [users, posts]);
 *
 * const rows = await database.sql`SELECT * FROM ${database.users}`.parse(database.users);
 * ```
 */
export const Database = Base as Omit<typeof Base, "prototype"> &
	(new <const T extends readonly Table.Any[]>(
		pool: Database.Pool,
		tables: T & Database.Valid<T>,
	) => Database<T>);

/** Postgres database with its tables accessible by name. */
export type Database<T extends readonly Table.Any[] = readonly Table.Any[]> =
	Base<T> & Database.Tables<T>;
