import type { Field } from "../form/index.js";
import type {
	StandardJSONSchemaV1,
	StandardSchemaV1,
} from "@standard-schema/spec";

/** Issue details, a `Schema.Issue` is only built for the public result. */
type Failure = {
	expected: unknown;
	path: Schema.Issue.Path;
	message: string | undefined;
};

/**
 * Keywords a schema adds to its JSON Schema as an object's property, which
 * fields use for their label and an unchecked box's default.
 */
export const annotate = Symbol("annotate");

/**
 * Preprocessors that only normalize input, so a stored value parses unchanged.
 * Tables allow these and reject other preprocessors.
 */
export const normalizers = new WeakSet<(value: any) => unknown>();

/**
 * Set a property, defining `__proto__` as data since assigning it would
 * change the object's prototype.
 *
 * @param data Object to set it on
 * @param name Property name
 * @param value Property value
 */
export const own = (
	data: Record<string, unknown>,
	name: string,
	value: unknown,
) => {
	if (name === "__proto__")
		Object.defineProperty(data, name, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	else data[name] = value;
};

/**
 * Add issues to a list, one at a time, since spreading a very long list
 * into `push` overflows the stack.
 *
 * @template I Issue
 * @param issues List to add to
 * @param more Issues to add
 */
export const append = <I>(issues: I[], more: readonly I[]) => {
	for (const issue of more) issues.push(issue);
};

/**
 * Convert to a number without rounding. Integers beyond 2^53 were or would
 * be rounded, so they are left as text, which fails a number's validation.
 *
 * @param value Value to convert, such as form text or a driver's `numeric`
 * @returns The number, or the text of an integer too large to be one
 */
export const exact = (value: unknown) => {
	const number = Number(value);

	return Number.isInteger(number) && !Number.isSafeInteger(number)
		? String(value)
		: number;
};

/**
 * Compiled parse function. Failures stay plain records until the public
 * `parse` builds the issues, so failed union branches cost no errors.
 */
type Run = (
	value: unknown,
	path: Schema.Issue.Path,
) => { data: any; issues?: never } | { data?: never; issues: Failure[] };

export namespace Schema {
	/**
	 * `Schema.parse` function type
	 *
	 * @template O Parse output
	 * @param value Unknown value to parse
	 * @param path Optional issue path (internal)
	 * @returns Parse result containing data or issues
	 */
	export type Parse<O> = (value: unknown, path?: Issue.Path) => Parse.Result<O>;

	export namespace Parse {
		/**
		 * Valid result type.
		 *
		 * @template O Parse output
		 */
		export interface Valid<O> {
			/** Valid parsed data */
			data: O;

			issues?: never;
		}

		/** Invalid result type. */
		export interface Invalid extends Schema.AggregateIssue {
			data?: never;
		}

		/**
		 * `Schema.parse` result containing `data` or invalid metadata.
		 *
		 * @template O Parse output
		 * @template M Extra invalid result metadata
		 * @template V Extra valid result metadata
		 */
		export type Result<O, M extends object = {}, V extends object = {}> =
			(Valid<O> & V) | (Invalid & M);
	}

	/**
	 * Infer Output type of a schema or shape.
	 *
	 * @template S Schema or shape type to infer from
	 */
	export type Infer<S> =
		S extends Schema<infer Output>
			? // regular schema
				Output
			: S extends Object.Shape
				? // object shape with optional keys preserved
					Object.Infer<S>
				: S extends any[]
					? // array - better zod compat
						Infer<S[number]>[]
					: never;

	export namespace JsonSchema {
		/** Supported JSON Schema dialects. */
		export type Target = "draft-2020-12" | "draft-07";

		/** `toJsonSchema` options. */
		export interface Options {
			/**
			 * JSON Schema dialect.
			 *
			 * @default "draft-2020-12"
			 */
			readonly target?: Target;

			/**
			 * Describe the accepted input or the parsed output.
			 *
			 * @default "output"
			 */
			readonly io?: "input" | "output";

			/**
			 * `"throw"` for values JSON Schema cannot describe (bigint, instances,
			 * transforms), or `"any"` to describe them as `{}`.
			 *
			 * @default "throw"
			 */
			readonly unrepresentable?: "throw" | "any";
		}

		/** Resolved options used while describing a schema (internal). */
		export type Context = Required<Options>;

		/** Description of one schema; `optional` keys are omitted from `required` (internal). */
		export interface Node {
			readonly schema: Record<string, unknown>;
			readonly optional?: boolean | undefined;
		}
	}

	/**
	 * Inspectable definition of a schema.
	 *
	 * Parsing, JSON Schema, and database tables are all derived from it.
	 */
	export type Def = (
		| { readonly type: "unknown" }
		| {
				readonly type: "string" | "boolean" | "number" | "bigint" | "date";
				readonly message?: string | undefined;
				/**
				 * A number's message when there is no value, where `message` is
				 * for a value that is not a number. A number field sets it, since
				 * text sent to it is not a field left empty.
				 */
				readonly missing?: string | undefined;
		  }
		| {
				readonly type: "literal";
				readonly value: unknown;
				readonly message?: string | undefined;
		  }
		| {
				readonly type: "enum";
				readonly values: readonly unknown[];
				readonly message?: string | undefined;
		  }
		| {
				readonly type: "instance";
				readonly class: new (...args: any[]) => unknown;
				readonly message?: string | undefined;
		  }
		| {
				readonly type: "array";
				readonly item: Schema<unknown>;
				readonly message?: string | undefined;
		  }
		| {
				readonly type: "object";
				readonly shape: Object.Shape;
				readonly mode: Object.Mode;
		  }
		| { readonly type: "union"; readonly options: readonly Schema<unknown>[] }
		| {
				readonly type: "optional" | "nullable" | "nullish";
				readonly inner: Schema<unknown>;
		  }
		| {
				readonly type: "default";
				readonly inner: Schema<unknown>;
				readonly value: unknown;
		  }
		| {
				readonly type: "preprocess" | "transform";
				readonly inner: Schema<unknown>;
				readonly fn: (value: any) => unknown;
		  }
		| {
				readonly type: "pipe";
				readonly inner: Schema<unknown>;
				readonly next: Schema<unknown>;
		  }
		| {
				readonly type: "json";
				readonly inner: Schema<unknown>;
				readonly schema: Schema<unknown>;
				readonly message?: string | undefined;
		  }
		| {
				readonly type: "check";
				readonly inner: Schema<unknown>;
				readonly check: Check;
		  }
	) & {
		/** What the value is, see `describe()` */
		readonly description?: string;
	};

	/** Validation applied to the output of another schema. */
	export type Check =
		| {
				readonly name: "min" | "max";
				readonly value: number | bigint;
				readonly message: string;
		  }
		| {
				readonly name: "int" | "email" | "url" | "uuid";
				readonly message: string;
		  }
		| {
				readonly name: "refine";
				readonly fn: (value: any) => boolean;
				readonly message: string;
		  };

	// interfaces, so that declaration files name them `Schema.Issue` and
	// `Schema.AggregateIssue`, which an alias of the class would not be

	/** Validation issue produced during parsing */
	export interface Issue extends IssueClass {}

	/** AggregateIssue containing at least one `Schema.Issue` */
	export interface AggregateIssue extends AggregateIssueClass {}

	export namespace Issue {
		/** Issue path representation. */
		export type Path = (string | number)[];

		/** Non-empty list of issues */
		export type List = readonly [Issue, ...Issue[]];
	}

	// this is to improve inferred type performance to help ts infer objects
	/**
	 * Object schema with extend capability.
	 *
	 * @template S Object shape type
	 * @template M How unknown keys are handled, `strip` by default
	 */
	export type Object<
		S extends Object.Shape,
		M extends Object.Mode = "strip",
	> = ObjectSchema<S, M>;

	export namespace Object {
		/** Object schema shape. */
		export type Shape = Record<string, Schema<unknown>>;

		/** Object parsing mode. */
		export type Mode = "strip" | "strict" | "loose";

		/**
		 * Names of shape keys whose output includes `undefined`.
		 *
		 * @template S Object shape
		 */
		export type Optional<S extends Shape> = {
			[K in keyof S]-?: undefined extends Schema.Infer<S[K]> ? K : never;
		}[keyof S];

		/**
		 * Names of shape keys whose output does not include `undefined`.
		 *
		 * @template S Object shape
		 */
		export type Required<S extends Shape> = Exclude<keyof S, Optional<S>>;

		/**
		 * Infer an object shape while turning `undefined` unions into optional keys.
		 *
		 * @template S Object shape
		 */
		export type Infer<S extends Shape> = {
			[K in Required<S>]: Schema.Infer<S[K]>;
		} & { [K in Optional<S>]?: Exclude<Schema.Infer<S[K]>, undefined> };

		/**
		 * Object output type by mode.
		 *
		 * @template S Object shape
		 * @template M Object mode
		 */
		export type Output<
			S extends Shape,
			M extends Mode = "strip",
		> = M extends "loose"
			? Schema.Infer<S> & Record<string, unknown>
			: Schema.Infer<S>;
	}
}

/** Shared shape types for `Shape` related runtime methods. */
export namespace ShapeUtil {
	/**
	 * Shape key name string.
	 *
	 * @template S Record-like shape
	 */
	export type Name<S extends Record<string, unknown>> = Extract<
		keyof S,
		string
	>;

	/**
	 * Merge two shapes where `B` overrides `A`.
	 *
	 * @template A Base shape
	 * @template B Extra shape
	 */
	export type Extend<
		A extends Record<string, unknown>,
		B extends Record<string, unknown>,
	> = globalThis.Omit<A, keyof B> & B;
}

/** Shared runtime shape operations used by object and form schema methods. */
export class ShapeUtil {
	/**
	 * Merge two record-like shapes where `extra` keys override `shape`.
	 *
	 * @template S Base shape
	 * @template E Extra shape
	 * @param shape Base shape
	 * @param extra Extra values to merge
	 * @returns Merged shape
	 */
	static extend<
		S extends Record<string, unknown>,
		E extends Record<string, unknown>,
	>(shape: S, extra: E): ShapeUtil.Extend<S, E> {
		return { ...shape, ...extra } as ShapeUtil.Extend<S, E>;
	}

	/**
	 * Pick keys from a record-like shape.
	 *
	 * @template S Shape
	 * @template N Selected key names
	 * @param shape Source shape
	 * @param names Non-empty list of keys to include
	 * @returns Picked shape
	 */
	static pick<S extends Record<string, unknown>, N extends ShapeUtil.Name<S>>(
		shape: S,
		names: readonly [N, ...N[]],
	): Pick<S, N> {
		const out: Record<string, unknown> = {};

		for (const name of names) {
			if (name in shape) own(out, name, shape[name]);
		}

		return out as Pick<S, N>;
	}

	/**
	 * Omit keys from a record-like shape.
	 *
	 * @template S Shape
	 * @template N Removed key names
	 * @param shape Source shape
	 * @param names Non-empty list of keys to remove
	 * @returns Omitted shape
	 */
	static omit<S extends Record<string, unknown>, N extends ShapeUtil.Name<S>>(
		shape: S,
		names: readonly [N, ...N[]],
	): Omit<S, N> {
		const remove = new Set<string>(names);
		const out: Record<string, unknown> = {};

		for (const [name, value] of Object.entries(shape)) {
			if (!remove.has(name)) own(out, name, value);
		}

		return out as Omit<S, N>;
	}
}

// named classes, so their published types are written by name and do not
// spell out what `Error` has in each runtime, such as Node's

/** Validation issue produced during parsing. */
class Issue extends Error {
	/** Expected type/value. */
	readonly expected: string;

	/** Path to the invalid value. */
	readonly path: Schema.Issue.Path;

	/**
	 * @param expected Expected value
	 * @param path Path to the invalid value
	 * @param message Issue message
	 */
	constructor(expected: unknown, path: Schema.Issue.Path, message?: string) {
		const exp = String(expected);

		super(message ?? `Expected ${exp}`);

		this.name = "Schema.Issue";
		this.expected = exp;
		this.path = path;
	}

	/**
	 * @returns `Schema.Issue(path): message`
	 */
	override toString() {
		let path = "";

		for (const segment of this.path) {
			path +=
				typeof segment === "number"
					? `[${segment}]`
					: `${path ? "." : path}${segment}`;
		}

		return `${this.name}${path ? `(${path})` : ""}: ${this.message}`;
	}

	toJSON() {
		return { ...this, message: this.message };
	}
}

/** The classes `Schema`'s issue types are named for */
type IssueClass = Issue;
type AggregateIssueClass = AggregateIssue;

/** AggregateIssue containing at least one Schema.Issue */
class AggregateIssue extends AggregateError {
	/** Non-empty tuple of issues */
	readonly issues: Schema.Issue.List;

	/** User submitted / sanitized values */
	readonly values: Field.Value.Map | undefined;

	/**
	 * Create a new AggregateIssue.
	 *
	 * Coerces issues into a non-empty tuple.
	 *
	 * @param issues Issues
	 * @param values Received values
	 */
	constructor([first, ...rest]: Schema.Issue[], values?: Field.Value.Map) {
		if (!first) throw new TypeError("AggregateIssue must have an issue.");

		const issues: Schema.Issue.List = [first, ...rest];
		const name = "Schema.AggregateIssue";
		const count = issues.length;

		super(issues, `${name}(${count})\n${issues.join("\n")}`);

		this.name = name;
		this.issues = issues;
		this.values = values;
	}

	override toString() {
		// prevents name being in the default twice since it's
		// already in the message
		return this.message;
	}

	toJSON() {
		return { ...this, message: this.message };
	}
}

/**
 * Minimal schema validator geared around parsing form data like
 * multipart `FormData` and `URLSearchParams`.
 *
 * Implements Standard Schema v1 and Standard JSON Schema v1 via the
 * `~standard` property (sync validate).
 *
 * @template Output Output type after parsing
 */
export class Schema<Output>
	implements
		StandardSchemaV1<unknown, Output>,
		StandardJSONSchemaV1<unknown, Output>
{
	/** Email regular expression */
	static readonly #emailRegex =
		/^(?!\.)(?!.*\.\.)([a-z0-9_'+\-\.]*)[a-z0-9_'+\-]@([a-z0-9][a-z0-9\-]*\.)+[a-z]{2,}$/i;

	/** UUID regular expression, any version */
	static readonly #uuidRegex =
		/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

	/** `$schema` URI for each supported target. */
	static readonly #dialects: Record<Schema.JsonSchema.Target, string> = {
		"draft-2020-12": "https://json-schema.org/draft/2020-12/schema",
		"draft-07": "http://json-schema.org/draft-07/schema#",
	};

	/** Validation issue produced during parsing. */
	static readonly Issue: new (
		...args: ConstructorParameters<typeof Issue>
	) => Schema.Issue = Issue;

	/** AggregateIssue containing at least one Schema.Issue */
	static readonly AggregateIssue: new (
		...args: ConstructorParameters<typeof AggregateIssue>
	) => Schema.AggregateIssue = AggregateIssue;

	readonly "~standard": StandardSchemaV1.Props<unknown, Output> &
		StandardJSONSchemaV1.Props<unknown, Output> = {
		version: 1,
		vendor: "ovr",
		validate: (value) => {
			const result = this.parse(value);

			return result.issues ? result : { value: result.data };
		},
		jsonSchema: {
			input: (options) => this.#standard(options, "input"),
			output: (options) => this.#standard(options, "output"),
		},
	};

	/** Inspectable definition this schema was built from. */
	readonly def: Schema.Def;

	/**
	 * Parse and validate an unknown value.
	 *
	 * @param value Unknown value to parse
	 * @param path Optional issue path (internal)
	 * @returns Parse result containing data or issues
	 */
	parse: Schema.Parse<Output>;

	/** Compiled parse, nested schemas share one path that is copied only into issues. */
	readonly #run: Run;

	/**
	 * Construct a new schema - used internally.
	 *
	 * Use static methods on `Schema` to make a new schema.
	 *
	 * @param def Schema definition
	 */
	protected constructor(def: Schema.Def) {
		const run = Schema.#compile(def);

		this.def = def;
		this.#run = run;
		this.parse = (value, path) => {
			const result = run(value, path ? [...path] : []);

			return result.issues
				? new Schema.AggregateIssue(
						result.issues.map(
							(issue) =>
								new Schema.Issue(issue.expected, issue.path, issue.message),
						),
					)
				: result;
		};
	}

	/**
	 * Required for Field to override and return a `Field` instance
	 * from the chained methods instead of a `Schema`
	 * @template O Output type of the new schema
	 * @param def Definition of the new schema
	 * @returns New schema instance based on the current instance
	 */
	protected derive<O>(def: Schema.Def) {
		return new Schema<O>(def);
	}

	/**
	 * Say what the value is. Agents read it as the `description` in its JSON
	 * Schema, such as of a tool's argument, and a field shows it to people
	 * under its control.
	 *
	 * ```ts
	 * Schema.string().uuid().describe("The bookmark's ID");
	 * Field.url().describe("An http or https address");
	 * ```
	 *
	 * @param text Description
	 * @returns Schema with the description
	 */
	describe(text: string) {
		return this.derive<Output>({ ...this.def, description: text }) as this;
	}

	/**
	 * @returns The description given with `describe()`, here or on the
	 * schema this one wraps, such as before `optional()`
	 */
	get description(): string | undefined {
		let def: Schema.Def | undefined = this.def;
		while (def) {
			if (def.description !== undefined) return def.description;
			def = "inner" in def ? def.inner.def : undefined;
		}
	}

	/**
	 * @internal Overridden by Field to describe itself as an object's property
	 * @param _io Side of the description
	 * @returns Keywords added to the property's JSON Schema
	 */
	[annotate](_io: "input" | "output"): Record<string, unknown> | void {}

	/**
	 * Convert the schema into a JSON Schema document.
	 *
	 * Refinements without a JSON Schema equivalent are omitted.
	 *
	 * @param options Target dialect, input/output side, and unrepresentable handling
	 * @returns JSON Schema object
	 */
	toJsonSchema(options: Schema.JsonSchema.Options = {}) {
		const {
			target = "draft-2020-12",
			io = "output",
			unrepresentable = "throw",
		} = options;

		if (!Object.hasOwn(Schema.#dialects, target)) {
			throw new TypeError(`Unsupported JSON Schema target: ${target}`);
		}

		return {
			$schema: Schema.#dialects[target],
			...Schema.#node(this, { target, io, unrepresentable }).schema,
		} as Record<string, unknown>;
	}

	/**
	 * @param options Standard JSON Schema options
	 * @param io Side of the description
	 * @returns JSON Schema object
	 */
	#standard(
		{ target, libraryOptions }: StandardJSONSchemaV1.Options,
		io: "input" | "output",
	) {
		return this.toJsonSchema({
			...libraryOptions,
			target: target as Schema.JsonSchema.Target,
			io,
		});
	}

	/**
	 * @param check Check to apply to the output
	 * @returns Checked schema
	 */
	#check(check: Schema.Check) {
		return this.derive<Output>({ type: "check", inner: this, check });
	}

	/**
	 * @param expected Expected value
	 * @param path Issue path, copied since parsing continues to change it
	 * @param message Issue message
	 * @returns Invalid result with one issue
	 */
	static #issue(expected: unknown, path: Schema.Issue.Path, message?: string) {
		return { issues: [{ expected, path: [...path], message }] };
	}

	/**
	 * Compile a definition into its parse function once, at construction.
	 *
	 * Nested schemas run with the parent's path, adding their key while they
	 * parse and removing it after, so valid values allocate no paths.
	 *
	 * @param def Schema definition
	 * @returns Parse function
	 */
	static #compile(def: Schema.Def): Run {
		switch (def.type) {
			case "unknown":
				return (v) => ({ data: v });
			case "string":
			case "boolean":
			case "bigint":
				return (v, path) =>
					typeof v === def.type
						? { data: v }
						: Schema.#issue(def.type, path, def.message);
			case "number":
				return (v, path) =>
					Number.isFinite(v) // isFinite checks type
						? { data: v }
						: Schema.#issue(
								"number",
								path,
								(v === undefined && def.missing) || def.message,
							);
			case "date":
				return (v, path) =>
					v instanceof Date && !Number.isNaN(v.getTime())
						? { data: v }
						: Schema.#issue("Date", path, def.message);
			case "literal":
				return (v, path) =>
					v === def.value
						? { data: def.value }
						: Schema.#issue(def.value, path, def.message);
			case "enum":
				return (v, path) => {
					for (const value of def.values) {
						if (v === value) return { data: value };
					}

					return Schema.#issue(
						def.values.map((v) => JSON.stringify(v)).join(" | "),
						path,
						def.message,
					);
				};
			case "instance":
				return (v, path) =>
					v instanceof def.class
						? { data: v }
						: Schema.#issue(def.class.name, path, def.message);
			case "array":
				return (v, path) => {
					if (!Array.isArray(v))
						return Schema.#issue("Array", path, def.message);

					const data: unknown[] = [];
					let issues: Failure[] | undefined;

					for (let i = 0; i < v.length; i++) {
						path.push(i);
						const result = def.item.#run(v[i], path);
						path.pop();

						if (result.issues) {
							// the first failure's list is new, so it is reused
							if (issues) append(issues, result.issues);
							else issues = result.issues;
						} else {
							data.push(result.data);
						}
					}

					return issues ? { issues } : { data };
				};
			case "object": {
				const shape = Object.entries(def.shape);

				return (value, path) => {
					if (
						value == null ||
						typeof value !== "object" ||
						Array.isArray(value)
					) {
						return Schema.#issue("Object", path);
					}

					const data: Record<string, unknown> = {};
					let issues: Failure[] | undefined;

					for (const [name, schema] of shape) {
						path.push(name);
						const result = schema.#run(
							(value as Record<string, unknown>)[name],
							path,
						);
						path.pop();

						if (result.issues) {
							if (issues) append(issues, result.issues);
							else issues = result.issues;
						} else if (result.data !== undefined) {
							own(data, name, result.data);
						}
					}

					if (def.mode !== "strip") {
						for (const [name, next] of Object.entries(value)) {
							if (!Object.hasOwn(def.shape, name)) {
								if (def.mode === "strict") {
									(issues ??= []).push({
										expected: "never",
										path: [...path, name],
										message: "Unexpected key",
									});
								} else {
									own(data, name, next);
								}
							}
						}
					}

					return issues ? { issues } : { data };
				};
			}
			case "union":
				return (v, path) => {
					const issues: Failure[] = [];

					for (const schema of def.options) {
						const result = schema.#run(v, path);

						// return as soon as one passes
						if (!result.issues) return result;

						append(issues, result.issues);
					}

					return { issues };
				};
			case "optional":
				return (v, path) =>
					v === undefined ? { data: v } : def.inner.#run(v, path);
			case "nullable":
				return (v, path) =>
					v === null ? { data: v } : def.inner.#run(v, path);
			case "nullish":
				return (v, path) => (v == null ? { data: v } : def.inner.#run(v, path));
			case "default":
				return (v, path) =>
					v === undefined ? { data: def.value } : def.inner.#run(v, path);
			case "preprocess":
				return (v, path) => def.inner.#run(def.fn(v), path);
			case "transform":
				return (v, path) => {
					const result = def.inner.#run(v, path);

					return result.issues ? result : { data: def.fn(result.data) };
				};
			case "pipe":
				return (v, path) => {
					const result = def.inner.#run(v, path);

					return result.issues ? result : def.next.#run(result.data, path);
				};
			case "json":
				return (v, path) => {
					const result = def.inner.#run(v, path);
					if (result.issues) return result;

					let data: unknown;

					try {
						data = JSON.parse(result.data as string);
					} catch {
						return Schema.#issue("JSON", path, def.message);
					}

					return def.schema.#run(data, path);
				};
			case "check": {
				const test = Schema.#test(def.check);

				return (v, path) => {
					const result = def.inner.#run(v, path);

					return result.issues || test(result.data)
						? result
						: Schema.#issue("refine", path, def.check.message);
				};
			}
		}
	}

	/**
	 * @param check Output check
	 * @returns Function that returns `false` when the value fails the check
	 */
	static #test(check: Schema.Check): (value: any) => boolean {
		switch (check.name) {
			// a string has between length / 2 and length code points, count only
			// between. An array is checked by its number of items.
			case "min": {
				const min = Number(check.value);

				return (v) =>
					typeof v === "string"
						? v.length >= min * 2 ||
							(v.length >= min && Schema.#length(v) >= min)
						: Array.isArray(v)
							? v.length >= min
							: v >= check.value;
			}
			case "max": {
				const max = Number(check.value);

				return (v) =>
					typeof v === "string"
						? v.length <= max ||
							(v.length <= max * 2 && Schema.#length(v) <= max)
						: Array.isArray(v)
							? v.length <= max
							: v <= check.value;
			}
			case "int":
				return Number.isSafeInteger;
			case "email":
				return (v) => Schema.#emailRegex.test(v);
			case "url":
				return URL.canParse;
			case "uuid":
				return (v) => Schema.#uuidRegex.test(v);
			case "refine":
				return check.fn;
		}
	}

	/**
	 * @param value String
	 * @returns Number of Unicode code points, a surrogate pair counts once
	 */
	static #length(value: string) {
		let length = value.length;

		for (let i = 0; i < value.length - 1; i++) {
			const code = value.charCodeAt(i);

			if (code >= 0xd800 && code <= 0xdbff) {
				const next = value.charCodeAt(i + 1);

				if (next >= 0xdc00 && next <= 0xdfff) {
					length--;
					i++;
				}
			}
		}

		return length;
	}

	/**
	 * Describe a schema as JSON Schema by walking its definition.
	 *
	 * @param schema Schema to describe
	 * @param c Description context
	 * @returns Description, optional when its key may be omitted
	 */
	static #node(
		schema: Schema<unknown>,
		c: Schema.JsonSchema.Context,
	): Schema.JsonSchema.Node {
		const node = Schema.#kind(schema, c);
		const { description } = schema.def;

		return description === undefined
			? node
			: { ...node, schema: { ...node.schema, description } };
	}

	/**
	 * @param schema Schema to describe
	 * @param c Context
	 * @returns JSON Schema of the schema's kind
	 */
	static #kind(
		schema: Schema<unknown>,
		c: Schema.JsonSchema.Context,
	): Schema.JsonSchema.Node {
		const { def } = schema;

		switch (def.type) {
			case "unknown":
				// accepts undefined, so the key may be absent
				return { schema: {}, optional: true };
			case "string":
			case "boolean":
			case "number":
				return { schema: { type: def.type } };
			case "bigint":
			case "date":
			case "instance":
				return Schema.#unrepresentable(
					c,
					def.type === "instance" ? `${def.class.name} instance` : def.type,
				);
			case "literal":
				return Schema.#values(c, [def.value]);
			case "enum":
				return Schema.#values(c, def.values);
			case "array":
				return {
					schema: { type: "array", items: Schema.#node(def.item, c).schema },
				};
			case "object": {
				const properties: Record<string, unknown> = {};
				const required: string[] = [];

				for (const [name, schema] of Object.entries(def.shape)) {
					const node = Schema.#node(schema, c);
					const extra = schema[annotate](c.io);

					own(properties, name, { ...node.schema, ...extra });
					// a key with a default may be left out
					if (!node.optional && extra?.default === undefined)
						required.push(name);
				}

				return {
					schema: {
						type: "object",
						properties,
						...(required.length && { required }),
						// strip accepts unknown input keys but removes them from the output
						...((def.mode === "strict" ||
							(def.mode === "strip" && c.io === "output")) && {
							additionalProperties: false,
						}),
					},
				};
			}
			case "union": {
				const nodes = def.options.map((schema) => Schema.#node(schema, c));

				return {
					schema:
						nodes.length === 1
							? nodes[0]!.schema
							: { anyOf: nodes.map((node) => node.schema) },
					optional: nodes.some((node) => node.optional),
				};
			}
			case "optional":
				return { ...Schema.#node(def.inner, c), optional: true };
			case "nullable":
			case "nullish": {
				const node = Schema.#node(def.inner, c);

				return {
					schema: { anyOf: [node.schema, { type: "null" }] },
					optional: def.type === "nullish" || node.optional,
				};
			}
			case "default": {
				const node = Schema.#node(def.inner, c);

				if (c.io === "input")
					return {
						schema: Schema.#isJson(def.value)
							? { ...node.schema, default: def.value }
							: node.schema,
						optional: true,
					};

				// the default is output without validation by the inner schema
				if (def.value === undefined)
					return { schema: node.schema, optional: true };
				if (!def.inner.parse(def.value).issues) return { schema: node.schema };
				if (!Schema.#isJson(def.value))
					return Schema.#unrepresentable(c, "Non-JSON default");

				return { schema: { anyOf: [node.schema, { const: def.value }] } };
			}
			case "preprocess":
				// any input, or none, may be preprocessed into a valid value, unless
				// the preprocessor only normalizes, where the input is the value
				return c.io === "input" && !normalizers.has(def.fn)
					? { schema: {}, optional: true }
					: Schema.#node(def.inner, c);
			case "transform":
				return c.io === "input"
					? Schema.#node(def.inner, c)
					: Schema.#unrepresentable(c, "Transform output");
			case "pipe":
				return Schema.#node(c.io === "input" ? def.inner : def.next, c);
			case "json": {
				if (c.io === "output") return Schema.#node(def.schema, c);

				const node = Schema.#node(def.inner, c);

				return {
					...node,
					schema: {
						...node.schema,
						contentMediaType: "application/json",
						// contentSchema was added after draft-07
						...(c.target === "draft-2020-12" && {
							contentSchema: Schema.#node(def.schema, c).schema,
						}),
					},
				};
			}
			case "check": {
				const node = Schema.#node(def.inner, c);

				// checks constrain the output, so they describe the input only when it is unchanged
				if (c.io === "input" && !Schema.#unchanged(def.inner.def)) return node;

				return {
					...node,
					schema: {
						...node.schema,
						...Schema.#keywords(def.check, node.schema),
					},
				};
			}
		}
	}

	/**
	 * @param def Schema definition
	 * @returns `true` when parsing never changes a valid value
	 */
	static #unchanged(def: Schema.Def): boolean {
		switch (def.type) {
			case "preprocess":
				// a normalizer leaves a valid value as it is
				return normalizers.has(def.fn) && Schema.#unchanged(def.inner.def);
			case "transform":
			case "json":
				return false;
			case "pipe":
				return (
					Schema.#unchanged(def.inner.def) && Schema.#unchanged(def.next.def)
				);
			case "union":
				return def.options.every((schema) => Schema.#unchanged(schema.def));
			case "optional":
			case "nullable":
			case "nullish":
			case "default":
			case "check":
				return Schema.#unchanged(def.inner.def);
		}

		return true;
	}

	/**
	 * @param check Output check
	 * @param schema Description being checked
	 * @returns JSON Schema keywords equivalent to the check
	 */
	static #keywords(check: Schema.Check, schema: Record<string, unknown>) {
		switch (check.name) {
			case "email":
			case "uuid":
				return { format: check.name };
			case "url":
				return { format: "uri" };
			case "int":
				return schema.type === "number" && { type: "integer" };
			case "min":
			case "max": {
				if (typeof check.value !== "number") return;

				const min = check.name === "min";
				// a string's length and an array's items are counted
				const length = schema.type === "string" || schema.type === "array";
				const key =
					schema.type === "string"
						? `${check.name}Length`
						: schema.type === "array"
							? `${check.name}Items`
							: (schema.type === "number" || schema.type === "integer") &&
								(min ? "minimum" : "maximum");

				if (!key) return;

				// counts are integers, so fractional bounds round inward
				const value = length
					? min
						? Math.max(0, Math.ceil(check.value))
						: Math.floor(check.value)
					: check.value;
				const current = schema[key];

				// repeated bounds all apply, so keep the strictest
				return {
					[key]:
						typeof current !== "number"
							? value
							: min
								? Math.max(current, value)
								: Math.min(current, value),
				};
			}
		}
	}

	/**
	 * @param c Description context
	 * @param name Unrepresentable schema name
	 * @returns `{}` when allowed by `c`
	 */
	static #unrepresentable(
		c: Schema.JsonSchema.Context,
		name: string,
	): Schema.JsonSchema.Node {
		if (c.unrepresentable === "any") return { schema: {} };

		throw new TypeError(`${name} cannot be represented in JSON Schema`);
	}

	/**
	 * @param value Value to check
	 * @returns `true` when the value round-trips through JSON unchanged
	 */
	static #isJson(value: unknown): boolean {
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "boolean"
		)
			return true;
		if (typeof value === "number") return Number.isFinite(value);
		if (Array.isArray(value)) return value.every(Schema.#isJson);
		if (
			typeof value === "object" &&
			Object.getPrototypeOf(value) === Object.prototype
		)
			return Object.values(value).every(Schema.#isJson);

		return false;
	}

	/**
	 * @param c Description context
	 * @param values Allowed literal values
	 * @returns `const` or `enum` description, optional when `undefined` is allowed
	 */
	static #values(
		c: Schema.JsonSchema.Context,
		values: readonly unknown[],
	): Schema.JsonSchema.Node {
		const defined = values.filter((v) => v !== undefined);

		if (!defined.every(Schema.#isJson)) {
			return Schema.#unrepresentable(c, "Non-JSON literal");
		}

		return {
			// `not: {}` matches nothing, so the key must be absent
			schema:
				defined.length === 0
					? { not: {} }
					: defined.length === 1
						? { const: defined[0] }
						: { enum: defined },
			optional: defined.length < values.length,
		};
	}

	/**
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @returns Optional field
	 */
	optional<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
	): Field.Instance<Output | undefined, T, U, V, undefined, I>;
	/**
	 * @returns Optional schema
	 */
	optional(this: Schema<Output>): Schema<Output | undefined>;
	optional(this: Schema<Output>) {
		return this.derive<Output | undefined>({ type: "optional", inner: this });
	}

	/**
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @returns Nullable field
	 */
	nullable<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
	): Field.Instance<Output | null, T, U, V, undefined, I>;
	/**
	 * @returns Nullable schema
	 */
	nullable(this: Schema<Output>): Schema<Output | null>;
	nullable(this: Schema<Output>) {
		return this.derive<Output | null>({ type: "nullable", inner: this });
	}

	/**
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @returns Nullish field
	 */
	nullish<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
	): Field.Instance<Output | null | undefined, T, U, V, undefined, I>;
	/**
	 * @returns Nullish schema
	 */
	nullish(this: Schema<Output>): Schema<Output | null | undefined>;
	nullish(this: Schema<Output>) {
		return this.derive<Output | null | undefined>({
			type: "nullish",
			inner: this,
		});
	}

	/**
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Default value to use when input is undefined
	 * @returns Field with default
	 */
	default<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
		value: Output,
	): Field.Instance<Output, T, U, V, undefined, I>;
	/**
	 * @param value Default value to use when input is undefined
	 * @returns Schema with default
	 */
	default(this: Schema<Output>, value: Output): Schema<Output>;
	default(this: Schema<Output>, value: Output) {
		return this.derive<Output>({ type: "default", inner: this, value });
	}

	/**
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param fn Preprocess function to run before parsing
	 * @returns Schema that preprocesses input before parsing
	 */
	preprocess<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
		fn: (value: unknown) => unknown,
	): Field.Instance<Output, T, U, V, undefined, I>;
	/**
	 * @param fn Preprocess function to run before parsing
	 * @returns Schema that preprocesses input before parsing
	 */
	preprocess(
		this: Schema<Output>,
		fn: (value: unknown) => unknown,
	): Schema<Output>;
	preprocess(this: Schema<Output>, fn: (value: unknown) => unknown) {
		return this.derive<Output>({ type: "preprocess", inner: this, fn });
	}

	/**
	 * @template O Output type after transformation
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param fn Transform function to apply to parsed output
	 * @returns Transformed field
	 */
	transform<
		O,
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
		fn: (value: Output) => O,
	): Field.Instance<O, T, U, V, undefined, I>;
	/**
	 * @template O Output type after transformation
	 * @param fn Transform function to apply to parsed output
	 * @returns Transformed schema
	 */
	transform<O>(this: Schema<Output>, fn: (value: Output) => O): Schema<O>;
	transform<O>(this: Schema<Output>, fn: (value: Output) => O) {
		return this.derive<O>({ type: "transform", inner: this, fn });
	}

	/**
	 * @template O Output type after pipe
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param next Schema to validate the result with
	 * @returns Piped field
	 */
	pipe<
		O,
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
		next: Schema<O>,
	): Field.Instance<O, T, U, V, undefined, I>;
	/**
	 * @template O Output type after pipe
	 * @param next Schema to validate the result with
	 * @returns Piped schema
	 */
	pipe<O>(this: Schema<Output>, next: Schema<O>): Schema<O>;
	pipe<O>(this: Schema<Output>, next: Schema<O>) {
		return this.derive<O>({ type: "pipe", inner: this, next });
	}

	/**
	 * Parse a JSON string and validate the parsed value with the provided schema.
	 *
	 * @template O Output type
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param schema Schema to validate the parsed JSON value with
	 * @param message Issue message when invalid
	 * @returns Parsed JSON field
	 */
	json<
		O,
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<string, T, U, V, undefined, I>,
		schema: Schema<O>,
		message?: string,
	): Field.Instance<O, T, U, V, undefined, I>;
	/**
	 * Parse a JSON string and validate the parsed value with the provided schema.
	 *
	 * @template O Output type
	 * @param schema Schema to validate the parsed JSON value with
	 * @param message Issue message when invalid
	 * @returns Parsed JSON schema
	 */
	json<O>(this: Schema<string>, schema: Schema<O>, message?: string): Schema<O>;
	json<O>(this: Schema<string>, schema: Schema<O>, message?: string) {
		return this.derive<O>({ type: "json", inner: this, schema, message });
	}

	/**
	 * Validate an input is a valid email string using
	 * [Reasonable Email Regex by Colin McDonnell](https://colinhacks.com/essays/reasonable-email-regex).
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param message Issue message when invalid
	 * @returns Email field
	 */
	email<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<string, T, U, V, undefined, I>,
		message?: string,
	): Field.Instance<string, T, U, V, undefined, I>;
	/**
	 * Validate an input is a valid email string using
	 * [Reasonable Email Regex by Colin McDonnell](https://colinhacks.com/essays/reasonable-email-regex).
	 *
	 * @param message Issue message when invalid
	 * @returns Email schema
	 */
	email(this: Schema<string>, message?: string): Schema<string>;
	email(this: Schema<string>, message = "Expected email") {
		return this.#check({ name: "email", message });
	}

	/**
	 * Validate an input is a UUID string of any version.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param message Issue message when invalid
	 * @returns UUID field
	 */
	uuid<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<string, T, U, V, undefined, I>,
		message?: string,
	): Field.Instance<string, T, U, V, undefined, I>;
	/**
	 * Validate an input is a UUID string of any version.
	 *
	 * @param message Issue message when invalid
	 * @returns UUID schema
	 */
	uuid(this: Schema<string>, message?: string): Schema<string>;
	uuid(this: Schema<string>, message = "Expected UUID") {
		return this.#check({ name: "uuid", message });
	}

	/**
	 * Validate an input is a valid URL string.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param message Issue message when invalid
	 * @returns URL field
	 */
	url<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<string, T, U, V, undefined, I>,
		message?: string,
	): Field.Instance<string, T, U, V, undefined, I>;
	/**
	 * Validate an input is a valid URL string.
	 *
	 * @param message Issue message when invalid
	 * @returns URL schema
	 */
	url(this: Schema<string>, message?: string): Schema<string>;
	url(this: Schema<string>, message = "Expected URL") {
		return this.#check({ name: "url", message });
	}

	/**
	 * Validate an input is a safe integer.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param message Issue message when invalid
	 * @returns Integer field
	 */
	int<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<number, T, U, V, undefined, I>,
		message?: string,
	): Field.Instance<number, T, U, V, undefined, I>;
	/**
	 * Validate an input is a safe integer.
	 *
	 * @param message Issue message when invalid
	 * @returns Integer schema
	 */
	int(this: Schema<number>, message?: string): Schema<number>;
	int(this: Schema<number>, message = "Expected integer") {
		return this.#check({ name: "int", message });
	}

	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * For strings, this validates minimum length in Unicode characters,
	 * as JSON Schema and Postgres count them.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Minimum value or length
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	min<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<string, T, U, V, undefined, I>,
		value: number,
		message?: string,
	): Field.Instance<string, T, U, V, undefined, I>;
	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Minimum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	min<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<number, T, U, V, undefined, I>,
		value: number,
		message?: string,
	): Field.Instance<number, T, U, V, undefined, I>;
	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Minimum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	min<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<bigint, T, U, V, undefined, I>,
		value: bigint,
		message?: string,
	): Field.Instance<bigint, T, U, V, undefined, I>;
	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * For strings, this validates minimum length in Unicode characters,
	 * as JSON Schema and Postgres count them.
	 *
	 * @param value Minimum value or length
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	min(this: Schema<string>, value: number, message?: string): Schema<string>;
	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * @param value Minimum value
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	min(this: Schema<number>, value: number, message?: string): Schema<number>;
	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * @param value Minimum value
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	min(this: Schema<bigint>, value: bigint, message?: string): Schema<bigint>;
	/**
	 * Validate a list has no fewer items than the minimum.
	 *
	 * @template A Array type
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Minimum number of items
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	min<
		A extends unknown[],
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<A, T, U, V, undefined, I>,
		value: number,
		message?: string,
	): Field.Instance<A, T, U, V, undefined, I>;
	/**
	 * Validate an array has no fewer items than the minimum.
	 *
	 * @template A Array type
	 * @param value Minimum number of items
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	min<A extends unknown[]>(
		this: Schema<A>,
		value: number,
		message?: string,
	): Schema<A>;
	min(
		this: Schema<string | number | bigint | unknown[]>,
		value: number | bigint,
		message = `Expected minimum ${value}`,
	) {
		return this.#check({ name: "min", value, message });
	}

	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * For strings, this validates maximum length in Unicode characters,
	 * as JSON Schema and Postgres count them.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Maximum value or length
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	max<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<string, T, U, V, undefined, I>,
		value: number,
		message?: string,
	): Field.Instance<string, T, U, V, undefined, I>;
	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Maximum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	max<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<number, T, U, V, undefined, I>,
		value: number,
		message?: string,
	): Field.Instance<number, T, U, V, undefined, I>;
	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Maximum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	max<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<bigint, T, U, V, undefined, I>,
		value: bigint,
		message?: string,
	): Field.Instance<bigint, T, U, V, undefined, I>;
	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * For strings, this validates maximum length in Unicode characters,
	 * as JSON Schema and Postgres count them.
	 *
	 * @param value Maximum value or length
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	max(this: Schema<string>, value: number, message?: string): Schema<string>;
	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * @param value Maximum value
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	max(this: Schema<number>, value: number, message?: string): Schema<number>;
	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * @param value Maximum value
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	max(this: Schema<bigint>, value: bigint, message?: string): Schema<bigint>;
	/**
	 * Validate a list has no more items than the maximum.
	 *
	 * @template A Array type
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param value Maximum number of items
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	max<
		A extends unknown[],
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<A, T, U, V, undefined, I>,
		value: number,
		message?: string,
	): Field.Instance<A, T, U, V, undefined, I>;
	/**
	 * Validate an array has no more items than the maximum.
	 *
	 * @template A Array type
	 * @param value Maximum number of items
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	max<A extends unknown[]>(
		this: Schema<A>,
		value: number,
		message?: string,
	): Schema<A>;
	max(
		this: Schema<string | number | bigint | unknown[]>,
		value: number | bigint,
		message = `Expected maximum ${value}`,
	) {
		return this.#check({ name: "max", value, message });
	}

	/**
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @template I What each item of a list field is
	 * @param check Validation function that returns `false` to fail
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	refine<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Options | undefined,
		I extends Field.Item | undefined,
	>(
		this: Field.Instance<Output, T, U, V, undefined, I>,
		check: (value: Output) => boolean,
		message: string,
	): Field.Instance<Output, T, U, V, undefined, I>;
	/**
	 * @param check Validation function that returns `false` to fail
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	refine(
		this: Schema<Output>,
		check: (value: Output) => boolean,
		message: string,
	): Schema<Output>;
	refine(
		this: Schema<Output>,
		check: (value: Output) => boolean,
		message: string,
	) {
		return this.#check({ name: "refine", fn: check, message });
	}

	/**
	 * Accepts any value and presents the data as `unknown`.
	 *
	 * @returns Unknown schema
	 */
	static unknown() {
		return new Schema<unknown>({ type: "unknown" });
	}

	/**
	 * Validate an input is a string.
	 *
	 * @param message Issue message when invalid
	 * @returns String schema
	 */
	static string(message?: string) {
		return new Schema<string>({ type: "string", message });
	}

	/**
	 * Validate an input is a `true` or `false` boolean.
	 *
	 * @param message Issue message when invalid
	 * @returns Boolean schema
	 */
	static boolean(message?: string) {
		return new Schema<boolean>({ type: "boolean", message });
	}

	/**
	 * Validate an input is a number.
	 *
	 * Rejects non-finite values like `NaN` and `Infinity`.
	 *
	 * @param message Issue message when invalid
	 * @returns Number schema
	 */
	static number(message?: string) {
		return new Schema<number>({ type: "number", message });
	}

	/**
	 * Validate an input is a big integer.
	 *
	 * @param message Issue message when invalid
	 * @returns Big integer schema
	 */
	static bigint(message?: string) {
		return new Schema<bigint>({ type: "bigint", message });
	}

	/**
	 * Validate an input is a valid `Date`.
	 *
	 * Rejects invalid dates like `new Date("")`.
	 *
	 * @param message Issue message when invalid
	 * @returns Date schema
	 */
	static date(message?: string) {
		return new Schema<Date>({ type: "date", message });
	}

	/**
	 * @template L Literal type
	 * @param literal Exact value to match
	 * @param message Issue message when invalid
	 * @returns Literal schema
	 */
	static literal<const L>(literal: L, message?: string) {
		return new Schema<L>({ type: "literal", value: literal, message });
	}

	/**
	 * Validates that the input is strictly equal (`===`) to one of the allowed
	 * values.
	 *
	 * @template A Allowed type
	 * @param allowed Allowed values
	 * @param message Issue message when invalid
	 * @returns Enum schema
	 */
	static enum<const A extends readonly [unknown, ...unknown[]]>(
		allowed: A,
		message?: string,
	) {
		return new Schema<A[number]>({ type: "enum", values: allowed, message });
	}

	/**
	 * Tries each schema in order and returns the first successfully parsed result.
	 *
	 * @template S Schemas type
	 * @param schemas Schemas to try in order
	 * @returns Union schema
	 */
	static union<
		const S extends readonly [Schema<unknown>, ...Schema<unknown>[]],
	>(schemas: S) {
		return new Schema<Schema.Infer<S[number]>>({
			type: "union",
			options: schemas,
		});
	}

	/**
	 * Validates an input is an instance of the constructor.
	 *
	 * @template O Output type
	 * @param constructor Constructor to validate the input is an instance of
	 * @param message Issue message when invalid
	 * @returns Validated instance
	 */
	static instance<O>(constructor: new (...args: any[]) => O, message?: string) {
		return new Schema<O>({ type: "instance", class: constructor, message });
	}

	/**
	 * Validates that the input is an array and parses each item.
	 *
	 * @template O Output type
	 * @param schema Schema for each array item
	 * @param message Issue message when invalid
	 * @returns Array schema
	 */
	static array<O>(schema: Schema<O>, message?: string) {
		return new Schema<O[]>({ type: "array", item: schema, message });
	}

	/**
	 * Validates each key in the shape and returns a new object of parsed outputs.
	 *
	 * @template S Object shape type
	 * @param shape Object shape with schemas for each key
	 * @returns Object schema
	 */
	static object<S extends Schema.Object.Shape = {}>(
		shape: S = {} as S,
	): Schema.Object<S> {
		return new ObjectSchema(shape, "strip");
	}
}

/**
 * Runtime object schema that validates plain objects and supports shape helpers.
 *
 * @template Shape Object shape type
 * @template Mode Object parsing mode
 */
class ObjectSchema<
	Shape extends Schema.Object.Shape,
	Mode extends Schema.Object.Mode = "strip",
> extends Schema<Schema.Object.Output<Shape, Mode>> {
	/** Object shape definitions. */
	readonly shape: Shape;

	/** Object parsing mode. */
	readonly #mode: Mode;

	/**
	 * Create a new object schema validator.
	 *
	 * @param shape Object shape
	 * @param mode Object parsing mode
	 * @param description Description from `describe()`
	 */
	constructor(
		shape: Shape,
		mode: Mode = "strip" as Mode,
		description?: string,
	) {
		super({
			type: "object",
			shape,
			mode,
			...(description !== undefined && { description }),
		});

		this.shape = shape;
		this.#mode = mode;
	}

	override describe(text: string) {
		// still an object schema, which `derive` would not make
		return new ObjectSchema(this.shape, this.#mode, text) as this;
	}

	/**
	 * Merge `extra` into the current shape.
	 *
	 * @template E Extra shape type
	 * @param extra Extra shape or object schema to merge
	 * @returns New object schema with the merged shape
	 */
	extend<E extends Schema.Object.Shape>(
		extra: E,
	): Schema.Object<ShapeUtil.Extend<Shape, E>, Mode>;
	/**
	 * Merge the shape of `extra`, an object schema, into the current shape.
	 *
	 * @template E Extra shape type
	 * @param extra Object schema to merge
	 * @returns New object schema with the merged shape
	 */
	extend<E extends Schema.Object.Shape>(
		extra: Schema.Object<E>,
	): Schema.Object<ShapeUtil.Extend<Shape, E>, Mode>;
	extend(extra: Schema.Object.Shape | Schema.Object<any>) {
		return new ObjectSchema(
			ShapeUtil.extend(
				this.shape,
				extra instanceof ObjectSchema ? extra.shape : extra,
			),
			this.#mode,
			this.def.description,
		);
	}

	/**
	 * Keep only selected field names.
	 *
	 * @template N Selected key names
	 * @param names Non-empty list of key names to keep
	 * @returns New object schema with only selected keys
	 */
	pick<N extends ShapeUtil.Name<Shape>>(
		names: readonly [N, ...N[]],
	): Schema.Object<Pick<Shape, N>, Mode> {
		return new ObjectSchema(
			ShapeUtil.pick(this.shape, names),
			this.#mode,
			this.def.description,
		);
	}

	/**
	 * Remove selected field names.
	 *
	 * @template N Removed key names
	 * @param names Non-empty list of key names to remove
	 * @returns New object schema without selected keys
	 */
	omit<N extends ShapeUtil.Name<Shape>>(
		names: readonly [N, ...N[]],
	): Schema.Object<Omit<Shape, N>, Mode> {
		return new ObjectSchema(
			ShapeUtil.omit(this.shape, names),
			this.#mode,
			this.def.description,
		);
	}

	/**
	 * Reject unknown keys during parsing.
	 *
	 * @returns New object schema in strict mode
	 */
	strict(): Schema.Object<Shape, "strict"> {
		return new ObjectSchema(this.shape, "strict", this.def.description);
	}

	/**
	 * Preserve unknown keys during parsing.
	 *
	 * @returns New object schema in loose mode
	 */
	loose(): Schema.Object<Shape, "loose"> {
		return new ObjectSchema(this.shape, "loose", this.def.description);
	}
}
