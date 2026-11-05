import { Fragment, type JSX, jsx } from "../jsx/index.js";
import { Multipart } from "../multipart/index.js";
import { Checksum, Codec, Size } from "../util/index.js";
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
 * Compiled parse function. Failures stay plain records until the public
 * `parse` builds the issues, so failed union branches cost no errors.
 */
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
const own = (data: Record<string, unknown>, name: string, value: unknown) => {
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
 * @param issues List to add to
 * @param more Issues to add
 */
const append = <I>(issues: I[], more: readonly I[]) => {
	for (const issue of more) issues.push(issue);
};

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
		export interface Invalid extends InstanceType<
			typeof Schema.AggregateIssue
		> {
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
	export type Def =
		| { readonly type: "unknown" }
		| {
				readonly type: "string" | "boolean" | "number" | "bigint" | "date";
				readonly message?: string | undefined;
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

	/** Schema.Issue type */
	export type Issue = InstanceType<typeof Schema.Issue>;

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
namespace ShapeUtil {
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
class ShapeUtil {
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
	static readonly Issue = class Issue extends Error {
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
	};

	/** AggregateIssue containing at least one Schema.Issue */
	static readonly AggregateIssue = class AggregateIssue extends AggregateError {
		/** Non-empty tuple of issues */
		readonly issues: Schema.Issue.List;

		/** User submitted / sanitized values */
		readonly values: Form.Value.Map | undefined;

		/**
		 * Create a new AggregateIssue.
		 *
		 * Coerces issues into a non-empty tuple.
		 *
		 * @param issues Issues
		 * @param values Received values
		 */
		constructor([first, ...rest]: Schema.Issue[], values?: Form.Value.Map) {
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
	};

	readonly "~standard": StandardSchemaV1.Props<unknown, Output> &
		StandardJSONSchemaV1.Props<unknown, Output> = {
		version: 1,
		vendor: "ovr",
		validate: (value) => {
			const result = this.parse(value);

			return result.issues ? result : { value: result.data };
		},
		jsonSchema: {
			input: ({ target, libraryOptions }) =>
				this.toJsonSchema({
					...libraryOptions,
					target: target as Schema.JsonSchema.Target,
					io: "input",
				}),
			output: ({ target, libraryOptions }) =>
				this.toJsonSchema({
					...libraryOptions,
					target: target as Schema.JsonSchema.Target,
					io: "output",
				}),
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
	constructor(def: Schema.Def) {
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
	 * @internal Required for Field to override and return a `Field` instance
	 * from the chained methods instead of a `Schema`
	 * @template O Output type of the new schema
	 * @param def Definition of the new schema
	 * @returns New schema instance based on the current instance
	 */
	derive<O>(def: Schema.Def) {
		return new Schema<O>(def);
	}

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
						: Schema.#issue("number", path, def.message);
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
			// a string has between length / 2 and length code points, count only between
			case "min": {
				const min = Number(check.value);

				return (v) =>
					typeof v === "string"
						? v.length >= min * 2 ||
							(v.length >= min && Schema.#length(v) >= min)
						: v >= check.value;
			}
			case "max": {
				const max = Number(check.value);

				return (v) =>
					typeof v === "string"
						? v.length <= max ||
							(v.length <= max * 2 && Schema.#length(v) <= max)
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
					// a browser leaves an unchecked box out and it reads as false, so
					// input, such as an agent's, may leave it out too
					const unchecked =
						c.io === "input" &&
						schema instanceof FieldSchema &&
						schema.type === "checkbox" &&
						!schema.values;

					own(
						properties,
						name,
						unchecked ? { ...node.schema, default: false } : node.schema,
					);
					if (!node.optional && !unchecked) required.push(name);
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
				// any input, or none, may be preprocessed into a valid value
				return c.io === "input"
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
				const length = schema.type === "string";
				const key = length
					? `${check.name}Length`
					: (schema.type === "number" || schema.type === "integer") &&
						(min ? "minimum" : "maximum");

				if (!key) return;

				// lengths are integers, so fractional bounds round inward
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
	 * @returns Optional field
	 */
	optional<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
	): Field.Instance<Output | undefined, T, U, V>;
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
	 * @returns Nullable field
	 */
	nullable<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
	): Field.Instance<Output | null, T, U, V>;
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
	 * @returns Nullish field
	 */
	nullish<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
	): Field.Instance<Output | null | undefined, T, U, V>;
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
	 * @param value Default value to use when input is undefined
	 * @returns Field with default
	 */
	default<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
		value: Output,
	): Field.Instance<Output, T, U, V>;
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
	 * @param fn Preprocess function to run before parsing
	 * @returns Schema that preprocesses input before parsing
	 */
	preprocess<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
		fn: (value: unknown) => unknown,
	): Field.Instance<Output, T, U, V>;
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
	 * @param fn Transform function to apply to parsed output
	 * @returns Transformed field
	 */
	transform<
		O,
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
		fn: (value: Output) => O,
	): Field.Instance<O, T, U, V>;
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
	 * @param next Schema to validate the result with
	 * @returns Piped field
	 */
	pipe<
		O,
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
		next: Schema<O>,
	): Field.Instance<O, T, U, V>;
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
	 * @param schema Schema to validate the parsed JSON value with
	 * @param message Issue message when invalid
	 * @returns Parsed JSON field
	 */
	json<
		O,
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<string, T, U, V>,
		schema: Schema<O>,
		message?: string,
	): Field.Instance<O, T, U, V>;
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
	 * @param message Issue message when invalid
	 * @returns Email field
	 */
	email<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<string, T, U, V>,
		message?: string,
	): Field.Instance<string, T, U, V>;
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
	 * @param message Issue message when invalid
	 * @returns UUID field
	 */
	uuid<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<string, T, U, V>,
		message?: string,
	): Field.Instance<string, T, U, V>;
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
	 * @param message Issue message when invalid
	 * @returns URL field
	 */
	url<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<string, T, U, V>,
		message?: string,
	): Field.Instance<string, T, U, V>;
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
	 * @param message Issue message when invalid
	 * @returns Integer field
	 */
	int<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<number, T, U, V>,
		message?: string,
	): Field.Instance<number, T, U, V>;
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
	 * @param value Minimum value or length
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	min<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<string, T, U, V>,
		value: number,
		message?: string,
	): Field.Instance<string, T, U, V>;
	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @param value Minimum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	min<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<number, T, U, V>,
		value: number,
		message?: string,
	): Field.Instance<number, T, U, V>;
	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @param value Minimum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	min<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<bigint, T, U, V>,
		value: bigint,
		message?: string,
	): Field.Instance<bigint, T, U, V>;
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
	min(
		this: Schema<string | number | bigint>,
		value: number | bigint,
		message = `Expected minimum ${String(value)}`,
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
	 * @param value Maximum value or length
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	max<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<string, T, U, V>,
		value: number,
		message?: string,
	): Field.Instance<string, T, U, V>;
	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @param value Maximum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	max<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<number, T, U, V>,
		value: number,
		message?: string,
	): Field.Instance<number, T, U, V>;
	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @param value Maximum value
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	max<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<bigint, T, U, V>,
		value: bigint,
		message?: string,
	): Field.Instance<bigint, T, U, V>;
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
	max(
		this: Schema<string | number | bigint>,
		value: number | bigint,
		message = `Expected maximum ${String(value)}`,
	) {
		return this.#check({ name: "max", value, message });
	}

	/**
	 * @template T Field tag name
	 * @template U Field input type attribute
	 * @template V Field option values
	 * @param check Validation function that returns `false` to fail
	 * @param message Issue message when invalid
	 * @returns Refined field
	 */
	refine<
		T extends Field.Tag,
		U extends Field.Type,
		V extends Field.Values | undefined,
	>(
		this: Field.Instance<Output, T, U, V>,
		check: (value: Output) => boolean,
		message: string,
	): Field.Instance<Output, T, U, V>;
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
	 */
	constructor(shape: Shape, mode: Mode = "strip" as Mode) {
		super({ type: "object", shape, mode });

		this.shape = shape;
		this.#mode = mode;
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
		return new ObjectSchema(ShapeUtil.pick(this.shape, names), this.#mode);
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
		return new ObjectSchema(ShapeUtil.omit(this.shape, names), this.#mode);
	}

	/**
	 * Reject unknown keys during parsing.
	 *
	 * @returns New object schema in strict mode
	 */
	strict(): Schema.Object<Shape, "strict"> {
		return new ObjectSchema(this.shape, "strict");
	}

	/**
	 * Preserve unknown keys during parsing.
	 *
	 * @returns New object schema in loose mode
	 */
	loose(): Schema.Object<Shape, "loose"> {
		return new ObjectSchema(this.shape, "loose");
	}
}

export namespace Form {
	/** Form field shape. */
	export type Shape = Record<string, Field.Any>;

	/** Persisted form value */
	export type Value = string | number | boolean | string[];

	export namespace Value {
		/**
		 * Value map by field name.
		 *
		 * @template S Shape type
		 */
		export type Map<S extends Shape = Shape> = Partial<
			Record<ShapeUtil.Name<S>, Value>
		>;

		/**
		 * Initial values by field name, for example a record being edited.
		 * Values a field cannot render, such as dates and `null`, are skipped.
		 *
		 * @template S Shape type
		 */
		export type Initial<S extends Shape = Shape> = {
			readonly [K in ShapeUtil.Name<S>]?: unknown;
		};
	}

	/**
	 * Encoded form state.
	 *
	 * @template S Shape type to infer value keys from
	 */
	export interface State<S extends Shape = Shape> {
		/** Form id generated using the field names */
		readonly id: string;

		/** Non-empty list of validation issues */
		readonly issues?: Schema.Issue.List;

		/** Map of field names to possible values */
		readonly values?: Value.Map<S>;
	}

	export namespace Parse {
		/**
		 * Field names that are not marked to stream as multipart parts.
		 *
		 * @template S Form shape
		 */
		type NonStreamNames<S extends Shape> = {
			[K in keyof S]-?: S[K] extends Field.Instance<any, any, any, any, infer P>
				? P extends true
					? never
					: K
				: never;
		}[keyof S];

		/**
		 * Parsed data shape with streamed `stream()` fields removed.
		 *
		 * @template S Form shape
		 */
		type NonStreamShape<S extends Shape> = Pick<S, NonStreamNames<S>>;

		/**
		 * Parsed form data output.
		 *
		 * @template S Form shape
		 */
		export type Data<S extends Shape> = Schema.Infer<NonStreamShape<S>>;

		/**
		 * Form parse result.
		 *
		 * @template S Form shape
		 * @template M Extra invalid result metadata
		 */
		export type Result<
			S extends Shape,
			M extends object = {},
		> = Schema.Parse.Result<
			Data<S>,
			Result.Invalid<M>,
			{
				/** Rest of the multipart parts to stream */
				readonly stream?: AsyncGenerator<Multipart.Part> | undefined;

				/**
				 * Create an invalid result for issues found after parsing, for
				 * example a database constraint, keeping persisted values.
				 *
				 * @param messages Issue message by field name
				 */
				readonly invalid: (
					messages: Messages<S>,
				) => Schema.Parse.Invalid & Result.Invalid<M>;
			}
		>;

		/**
		 * Issue messages by field name.
		 *
		 * @template S Form shape
		 */
		export type Messages<S extends Shape> = {
			readonly [K in ShapeUtil.Name<S>]?: string;
		};

		export namespace Result {
			/** Form search params iterable */
			export type Search = [[(typeof Form.params)[1], string]] | undefined;

			/**
			 * Invalid result metadata.
			 *
			 * @template M Extra invalid result metadata
			 */
			export type Invalid<M extends object = {}> = {
				/** Encoded URL search param field state */
				readonly search: Search;

				/** Invalid parses do not expose remaining multipart parts */
				readonly stream?: never;
			} & M;
		}
	}
}

/**
 * Form schema with JSX rendering capabilities.
 *
 * Parses `FormData` or `URLSearchParams` and generates form field
 * components.
 *
 * @template Shape Form field shape type
 */
export class Form<Shape extends Form.Shape = Form.Shape> {
	/** Query param keys ordered as `[return, form]`. */
	static readonly params = ["_return", "_form"] as const;

	/** Maximum encoded state size in bytes. */
	static readonly #maxStateBytes = 4 * Size.kb;

	/** Maximum serialized size for a single persisted value. */
	static readonly #maxValueChars = 512;

	/** Schema used to validate persisted form values. */
	static readonly #valueSchema = Schema.union([
		Schema.string(),
		Schema.number(),
		Schema.boolean(),
		Schema.array(Schema.string()),
	]);

	/** Form id. */
	readonly #id: string;

	/** Field definitions. */
	readonly shape: Shape;

	/** Field names in definition order. */
	readonly names: ShapeUtil.Name<Shape>[];

	/** Maximum expected multipart parts derived from field cardinality. */
	readonly parts: number;

	/**
	 * Create a new form schema validator.
	 *
	 * @param shape Form fields
	 */
	constructor(shape: Shape) {
		this.shape = shape;
		this.names = Object.keys(this.shape) as ShapeUtil.Name<Shape>[];
		this.#id = Checksum.djb2(this.names.join());
		this.parts = Object.values(this.shape).reduce(
			(sum, field) => sum + field.parts,
			0,
		);
	}

	/**
	 * Merge `extra` into the current fields.
	 *
	 * @template E Extra field shape type
	 * @param extra Extra fields or form schema to merge
	 * @returns New form schema with merged fields
	 */
	extend: {
		<E extends Form.Shape>(extra: E): Form<ShapeUtil.Extend<Shape, E>>;
		<E extends Form.Shape>(extra: Form<E>): Form<ShapeUtil.Extend<Shape, E>>;
		(extra: Form<any>): Form<ShapeUtil.Extend<Shape, Form.Shape>>;
	} = (extra: Form.Shape | Form<any>) =>
		Form.from(
			ShapeUtil.extend(this.shape, extra instanceof Form ? extra.shape : extra),
		);

	/**
	 * Keep only selected field names.
	 *
	 * @template N Selected field names
	 * @param names Non-empty list of field names to keep
	 * @returns New form schema with only selected fields
	 */
	pick = <N extends ShapeUtil.Name<Shape>>(names: readonly [N, ...N[]]) =>
		Form.from(ShapeUtil.pick(this.shape, names));

	/**
	 * Remove selected field names.
	 *
	 * @template N Field names to remove
	 * @param names Non-empty list of field names to remove
	 * @returns New form schema without selected fields
	 */
	omit = <N extends ShapeUtil.Name<Shape>>(names: readonly [N, ...N[]]) =>
		Form.from(ShapeUtil.omit(this.shape, names));

	/**
	 * @param name Unexpected form field name
	 * @param path Parent path
	 * @returns Schema issue for unexpected form field names
	 */
	#unexpected(name: string, path: Schema.Issue.Path = []) {
		return new Schema.Issue(
			"known form data name",
			[...path, name],
			"Unexpected form data name",
		);
	}

	/**
	 * Sanitizes render-state values by removing unsupported or oversized entries.
	 *
	 * @param values Candidate values to keep
	 * @param persist When `true`, only allow fields marked with `.persist()`
	 * @param limit When `true`, drop values too long to keep in the URL
	 * @returns Sanitized values
	 */
	#sanitize(values?: Record<string, unknown>, persist = true, limit = true) {
		const sanitized: Form.Value.Map<Shape> = {};

		if (values) {
			for (const [name, value] of Object.entries(values)) {
				const field = Object.hasOwn(this.shape, name)
					? this.shape[name]
					: undefined;

				if (
					field &&
					field.type !== "file" &&
					(!persist || FieldSchema.persisted(field)) &&
					value != null
				) {
					const result = Form.#valueSchema.parse(value);

					if (
						!result.issues &&
						(!limit ||
							JSON.stringify(result.data).length <= Form.#maxValueChars)
					) {
						own(sanitized, name, result.data);
					}
				}
			}

			if (Object.keys(sanitized).length) return sanitized;
		}
	}

	/**
	 * Decode form state, over the initial values.
	 *
	 * @param stateInput Current page URL
	 * @param initial Initial values, submitted values take precedence
	 */
	#decode(
		stateInput?: URL,
		initial?: Form.Value.Initial<Shape>,
	): Form.State<Shape> | undefined {
		const state = this.#restore(stateInput);
		// initial values come from the server, not the URL, so no size limit
		const values = this.#sanitize(initial, false, false);

		if (!values) return state;

		return { id: this.#id, ...state, values: { ...values, ...state?.values } };
	}

	/**
	 * Restore form state from the URL.
	 *
	 * @param stateInput Current page URL
	 */
	#restore(stateInput?: URL): Form.State<Shape> | undefined {
		if (stateInput) {
			const values = this.#sanitize(
				this.names.reduce<Record<string, unknown>>((data, name) => {
					if (stateInput.searchParams.has(name)) {
						const value = FieldSchema.read(
							this.shape[name]!,
							stateInput.searchParams,
							name,
						);

						if (value != null) own(data, name, value);
					}

					return data;
				}, {}),
				false,
			);
			const encoded = stateInput.searchParams.get(Form.params[1]);

			if (encoded && encoded.length <= Form.#maxStateBytes * 2) {
				try {
					const result = Schema.string()
						.json(
							Schema.object({
								id: Schema.literal(this.#id),
								issues: Schema.array(
									Schema.object({
										expected: Schema.string(),
										path: Schema.array(
											Schema.union([Schema.string(), Schema.number()]),
										),
										message: Schema.string(),
									}).transform(
										(issue) =>
											new Schema.Issue(
												issue.expected,
												issue.path,
												issue.message,
											),
									),
								).optional(),
								values: Schema.object(
									this.names.reduce<Schema.Object.Shape>((shape, name) => {
										own(shape, name, Form.#valueSchema.optional());

										return shape;
									}, {}),
								).optional(),
							}),
						)
						.parse(Codec.decode(Codec.Base64Url.decode(encoded)));

					if (result.data?.id === this.#id) {
						const current = this.#sanitize(result.data.values);

						return {
							...result.data,
							values: (values || current) && { ...values, ...current },
						} as unknown as Form.State<Shape>;
					}
				} catch {}
			}

			return values && { id: this.#id, values };
		}
	}

	/**
	 * Create an invalid result, encoding the issues and persisted values so the
	 * next render can show them.
	 *
	 * @param issues Issues
	 * @param values Submitted values, only persisted fields are kept
	 * @returns Invalid result with its encoded search param
	 */
	#invalid(issues: Schema.Issue[], values: Record<string, unknown>) {
		const result = new Schema.AggregateIssue(issues, this.#sanitize(values));
		let search: Form.Parse.Result.Search;

		if (result.values) {
			// trim persisted values until the encoded state fits
			for (let i = this.names.length; i >= 0; i--) {
				// skip on the first time - try to encode everything first
				if (i !== this.names.length) delete result.values[this.names[i]!];

				const state = Codec.encode(
					JSON.stringify({
						issues: result.issues,
						id: this.#id,
						...(Object.keys(result.values).length
							? { values: result.values }
							: {}),
					} satisfies Form.State),
				);

				if (state.byteLength <= Form.#maxStateBytes) {
					search = [[Form.params[1], Codec.Base64Url.encode(state)]];
					break;
				}
			}
		} else {
			// fall back to issues-only state when nothing persisted.
			const state = Codec.encode(
				JSON.stringify({
					issues: result.issues,
					id: this.#id,
				} satisfies Form.State),
			);

			if (state.byteLength <= Form.#maxStateBytes) {
				search = [[Form.params[1], Codec.Base64Url.encode(state)]];
			}
		}

		return Object.assign(result, { search });
	}

	/**
	 * Parse and validate form data.
	 *
	 * @param source FormData, URLSearchParams, or Multipart to parse
	 * @param path Internal path reference
	 * @returns Parsed result
	 */
	parse = async (
		source: FormData | URLSearchParams | Multipart,
		path: Schema.Issue.Path = [],
	): Promise<Form.Parse.Result<Shape>> => {
		const data: Record<string, unknown> = {};
		const issues: Schema.Issue[] = [];
		const values: Record<string, unknown> = {};
		let form: FormData | URLSearchParams;
		let stream: AsyncGenerator<Multipart.Part> | undefined;

		if (source instanceof Multipart) {
			form = new FormData();
			const iter = source[Symbol.asyncIterator]();

			// a failure ends the parts, which also stops the upload
			try {
				let current: IteratorResult<Multipart.Part>;

				while ((current = await iter.next()) && !current.done) {
					const part = current.value;

					if (part.name) {
						// own fields only, so a name such as "constructor" is unexpected
						const field = Object.hasOwn(this.shape, part.name)
							? this.shape[part.name]
							: undefined;

						if (!field) {
							issues.push(this.#unexpected(part.name, path));
						} else if (field.streaming) {
							// expose current and rest of the parts to the user
							stream = (async function* () {
								try {
									// have to yield the current part first
									// this is why the multipart can't be passed directly
									yield part;

									let next: IteratorResult<Multipart.Part>;

									while ((next = await iter.next()) && !next.done) {
										yield next.value;
									}
								} finally {
									try {
										await iter.return?.();
									} catch {}
								}
							})();

							break;
						} else {
							form.append(part.name, await part.value());
						}
					}
				}
			} catch (error) {
				await iter.return?.().catch(() => {});
				throw error;
			}
		} else if (source instanceof FormData) {
			form = source;

			for (const name of new Set(source.keys())) {
				if (!Object.hasOwn(this.shape, name))
					issues.push(this.#unexpected(name, path));
			}
		} else {
			// allow passthrough for URLSearchParams
			form = source;
		}

		for (const [name, field] of Object.entries(this.shape)) {
			if (!field.streaming) {
				const value = FieldSchema.read(field, form, name);
				const result = field.parse(value, [...path, name]);

				if (result.issues) {
					append(issues, result.issues);
				} else if (result.data !== undefined) {
					own(data, name, result.data);
				}

				// a cleared field is recorded empty, so it overrides initial values
				if (FieldSchema.persisted(field)) own(values, name, value ?? "");
			}
		}

		if (issues.length) {
			if (stream) {
				// invalid result does not expose streamed parts, drain
				try {
					for await (const _ of stream);
				} catch {}
			}

			return this.#invalid(issues, values);
		}

		return {
			data: data as Form.Parse.Data<Shape>,
			stream,
			invalid: (messages: Form.Parse.Messages<Shape>) =>
				this.#invalid(
					Object.entries(messages).flatMap(([name, message]) =>
						typeof message === "string"
							? [new Schema.Issue("valid", [name], message)]
							: [],
					),
					values,
				),
		};
	};

	/**
	 * Render a single form field.
	 *
	 * @param props Component props
	 * @example
	 *
	 * ```tsx
	 * <User.Field name="username" />
	 * ```
	 */
	Field = ({
		values,
		...props
	}: Field.Component.Props<Shape> & {
		values?: Form.Value.Initial<Shape> | undefined;
	}) =>
		this.shape[props.name]!.render({
			...props,
			state: this.#decode(props.state, values),
		});

	/**
	 * Render all form fields.
	 *
	 * @param props Component props
	 * @example
	 *
	 * ```tsx
	 * <User.Fields />
	 * ```
	 */
	Fields = ({
		values,
		...props
	}: // partial because name is not required
	Partial<Field.Component.Props<Shape>> & {
		values?: Form.Value.Initial<Shape> | undefined;
	} = {}) => {
		const state = this.#decode(props.state, values); // pulled out to not call each map iteration

		return this.names.map((name) =>
			this.shape[name]!.render({ ...props, name, state }),
		);
	};

	/**
	 * Access bound sub-components for a field.
	 *
	 * @template N Type of the form field name
	 * @param props Field component props
	 * @example
	 *
	 * ```tsx
	 * const Radio = User.component({ name: "radio" });
	 *
	 * <Radio.Label />
	 * <Radio.Control />
	 * ```
	 */
	component = <N extends ShapeUtil.Name<Shape>>({
		values,
		...props
	}: { name: N } & Field.Component.Props<Shape> & {
			values?: Form.Value.Initial<Shape> | undefined;
		}): Field.Component<Shape[N]> =>
		this.shape[props.name]!.component({
			...props,
			state: this.#decode(props.state, values),
		});

	/**
	 * Create a Form from a shape or use another Form.
	 *
	 * @template S Form field shape type
	 * @param shape Form fields
	 */
	static from<S extends Form.Shape>(shape: S | Form<S>): Form<S> {
		return shape instanceof Form ? shape : new Form(shape);
	}
}

/**
 * Represents a form field with parsing logic and rendering metadata.
 *
 * @template Output Output type of the field
 * @template Tag Tag name
 * @template Type Input type
 * @template Values Persisted field value type
 * @template Stream If the field should be streamed as a part
 */
class FieldSchema<
	Output = unknown,
	Tag extends Field.Tag = "input",
	Type extends Field.Type = Field.Type,
	Values extends Field.Values | undefined = undefined,
	Stream extends boolean | undefined = undefined,
> extends Schema<Output> {
	/** Read the value from form data */
	readonly #read: Field.Read;

	/** Field type */
	readonly type: Type;

	// tag and values are public so emitted .d.ts preserves
	// field discriminants for correct types
	/** Field tag */
	readonly tag: Tag;

	/** Field values */
	readonly values: Values;

	/** Maximum expected multipart part count for this field name. */
	readonly parts: number;

	/** If the field should be streamed as a part */
	readonly streaming: Stream | undefined;

	/** If the field should persist invalid-state values. */
	readonly #persist: boolean;

	/** Field options */
	readonly #options: Field.Options<Values, Tag>;

	/**
	 * Create a new field.
	 *
	 * @param options Field options
	 * @param schema How to validate the input
	 * @param read How to read the form data
	 * @param parts Maximum expected multipart parts for this field
	 * @param stream If this field should be streamed as a multipart part
	 * @param persist If this field should persist invalid state values
	 */
	constructor(
		options: Field.Options<Values, Tag>,
		schema: Schema<Output> | Schema.Def,
		// default to a single value, treating blank as missing
		read: Field.Read = (data, name) => data.get(name) || undefined,
		parts = 1,
		stream?: Stream,
		persist = false,
	) {
		super(schema instanceof Schema ? schema.def : schema);

		this.#options = options;
		this.tag = (options.tag ?? "input") as Tag;
		this.values = options.values as Values;
		this.#read = read;
		this.type = options.props?.type as Type;
		this.parts = parts;
		this.streaming = stream;
		this.#persist = persist;
	}

	/**
	 * @param field Field instance
	 * @param data Form data source
	 * @param name HTML name attribute
	 * @returns Raw field input
	 */
	static read(
		field: Field.Any,
		data: FormData | URLSearchParams,
		name: string,
	) {
		return field.#read(data, name);
	}

	/**
	 * Stream this field as a multipart request `Part`.
	 *
	 * @returns Part field
	 */
	stream(): Field.Instance<Output, Tag, Type, Values, true> {
		return new FieldSchema<Output, Tag, Type, Values, true>(
			this.#options,
			this.def,
			this.#read,
			this.parts,
			true,
			this.#persist,
		);
	}

	/**
	 * Persist this field in the encoded invalid form state.
	 *
	 * Use this for non-sensitive values that should refill after an invalid
	 * redirect.
	 *
	 * @returns Field that persists submitted values across invalid redirects
	 */
	persist<
		U extends (Tag extends "input" ? Exclude<Type, "password" | "file"> : Type),
	>(
		this: Field.Instance<Output, Tag, U, Values, Stream>,
	): Field.Instance<Output, Tag, U, Values, Stream>;
	persist() {
		return new FieldSchema<Output, Tag, Type, Values, Stream>(
			this.#options,
			this.def,
			this.#read,
			this.parts,
			this.streaming,
			true,
		);
	}

	/**
	 * Derive a new Field from the current instance type.
	 *
	 * @template O Output type of the new Field
	 * @param def Definition of the new Field
	 * @returns New `Field` instance
	 */
	override derive<O>(
		def: Schema.Def,
	): Field.Instance<O, Tag, Type, Values, Stream> {
		return new FieldSchema<O, Tag, Type, Values, Stream>(
			this.#options,
			def,
			this.#read,
			this.parts,
			this.streaming,
			this.#persist,
		);
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Field component with sub-components
	 */
	component<S extends Form.Shape>(
		props: Field.Component.Props<S, false>,
	): Field.Component<this>;
	component<S extends Form.Shape>({
		state,
		...props
	}: Field.Component.Props<S, false>): unknown {
		const value = state?.values?.[props.name];
		const issue = state?.issues?.find((i) => i.path[0] === props.name);
		const issueId = issue && `${props.name}-issue`;
		const hidden = this.type === "hidden";
		const { label = props.name, ...control } = {
			id: hidden ? undefined : props.name,
			autofocus: issue && state?.issues?.[0] === issue,
			"aria-invalid": issue && "true",
			"aria-describedby": issueId,
			...this.#options.props,
			...props,
		};

		const Issue = (data: Field.Component.Issue = {}) =>
			issue && // render nothing if no issue
			!hidden &&
			jsx("p", {
				id: issueId,
				children: issue.message,
				"data-issue": issue && state!.issues!.indexOf(issue), // issue index starting from 0
				...data,
			});

		if (this.values && this.tag !== "select") {
			// radio/checkboxes
			// make multiple ids for the group so all don't have the same id
			const groupId = (value: string) =>
				`${control.name}-${value}`.toLowerCase();

			const Control = (
				data: Field.Component.Control.Group<"input", Field.Values>,
			) =>
				jsx(this.tag, {
					...control,
					id: groupId(data.value),
					// autofocus only the first input in the group
					autofocus: control.autofocus && data.value === this.values?.[0],
					checked: Array.isArray(value)
						? value.includes(data.value) // checkboxes
						: value === data.value, // radio
					...data,
				});

			const Label = ({
				value,
				...rest
			}: Field.Component.Label.Group<Field.Values>) =>
				jsx("label", { for: groupId(value), children: value, ...rest });

			return {
				Issue,
				Label,
				Control,
				Root: (data: Field.Component.Root = {}) => jsx("fieldset", data),
				Option: ({
					value,
					...rest
				}: Field.Component.Option.Input<Field.Values>) =>
					jsx("div", {
						children: [Control({ value }), Label({ value })],
						...rest,
					}),
				Legend: (data: Field.Component.Legend = {}) =>
					jsx("legend", { children: label, ...data }),
				...this,
			};
		}

		return {
			Issue,
			Root: (data: Field.Component.Root = {}) =>
				hidden ? Fragment(data) : jsx("div", data),
			Label: (data: Field.Component.Label = {}) =>
				!hidden && jsx("label", { for: control.id, children: label, ...data }),
			Control: (data?: Field.Component.Control<Tag>) => {
				const attrs = { ...control, ...data };

				if (value !== undefined) {
					if (this.tag === "textarea") {
						attrs.children = value;
					} else if (this.tag === "input") {
						if (this.type === "checkbox") {
							attrs.checked = value;
						} else {
							attrs.value = value;
						}
					}
				}

				return jsx(this.tag, attrs);
			},
			Option:
				// select
				this.values &&
				((data: Field.Component.Option<Field.Values>) =>
					jsx("option", {
						children: data.value,
						selected: Array.isArray(value)
							? value.includes(data.value) // multiselect
							: value === data.value,
						...data,
					})),
			...this,
		};
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Input group component
	 */
	#Group<S extends Form.Shape>(
		this: FieldSchema<Output, "input", "radio" | "checkbox", Field.Values>,
		props: Field.Component.Props<S, false>,
	) {
		const c = this.component(props);

		return c.Root({
			children: [
				// @ts-expect-error - `#Group` runs for grouped inputs, includes `Legend` with label
				c.Legend(),
				this.values.map((value: string) => {
					return jsx("div", {
						children: [c.Control({ value }), c.Label({ value })],
					});
				}),
				c.Issue(),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Select component
	 */
	#Select<S extends Form.Shape>(
		this: FieldSchema<Output, "select", Type, Field.Values>,
		props: Field.Component.Props<S, false>,
	) {
		const c = this.component(props);

		return c.Root({
			children: [
				c.Label(),
				c.Control({
					children: this.values.map((value: string) => c.Option({ value })),
				}),
				c.Issue(),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Default input component
	 */
	#Input<S extends Form.Shape>(props: Field.Component.Props<S, false>) {
		const c = this.component(props);

		return c.Root({ children: [c.Label(), c.Control(), c.Issue()] });
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props including `name` of the field to render
	 * @returns Component that renders the HTML field with default structure
	 */
	render<S extends Form.Shape>(props: Field.Component.Props<S, false>) {
		if (this.values) {
			if (this.tag === "select") return this.#Select(props);

			return this.#Group(props);
		}

		return this.#Input(props);
	}

	/**
	 * @param field Field definition
	 * @returns `true` when the field persists invalid-state values
	 */
	static persisted(field: Field.Any) {
		return field.#persist;
	}
}

/**
 * @param value Schema
 * @returns `true` for a form field, such as a table column made with `Field`
 */
export const field = (value: unknown): value is Field.Any =>
	value instanceof FieldSchema;

export namespace Field {
	/**
	 * Base options to create a Field.
	 *
	 * @template V Type of the values for group inputs
	 * @template T Tag name
	 */
	export interface Options<
		V extends Values | undefined = undefined,
		T extends Tag = Tag,
	> {
		/**
		 * Tag name.
		 *
		 * @default "input"
		 */
		readonly tag?: T;

		/** Values are used for group inputs */
		readonly values?: V;

		/** Field props */
		readonly props?: Props | undefined;
	}

	/**
	 * Raw field value before schema parsing.
	 *
	 * Single-value fields read one entry, multi-value fields read all entries,
	 * and checkboxes read presence.
	 */
	export type Input =
		FormDataEntryValue | FormDataEntryValue[] | boolean | undefined;

	/**
	 * @param data FormData or URLSearchParams
	 * @param name HTML name attribute
	 * @returns Resolved value read from the form data
	 */
	export type Read = (data: FormData | URLSearchParams, name: string) => Input;

	/** Form field tag name */
	export type Tag = "input" | "textarea" | "select";

	/** `<input type=...>` */
	export type Type = JSX.IntrinsicElements["input"]["type"];

	/** Value type for select and radio options */
	export type Values = readonly [string, ...string[]];

	/** Field instance type */
	export type Instance<
		Output = unknown,
		Tag extends Field.Tag = "input",
		Type extends Field.Type = Field.Type,
		Values extends Field.Values | undefined = undefined,
		Stream extends boolean | undefined = undefined,
	> = FieldSchema<Output, Tag, Type, Values, Stream>;

	/** Any field - `<input type=...>` / `<select>` / `<textarea>` */
	export type Any = Instance<
		any,
		Tag,
		Type,
		Values | undefined,
		boolean | undefined
	>;

	/**
	 * Obtain the tag name of a field.
	 *
	 * @template F Field
	 */
	export type TagOf<F extends Any> =
		F extends Instance<any, infer T, Field.Type, Field.Values | undefined>
			? T
			: Tag;

	export namespace Component {
		/**
		 * Component props available to users to pass into the
		 * constructed `<Field />` component.
		 *
		 * @template S Form shape type
		 * @template I `true` the state is a `URL`, `false` is just `State`
		 */
		export type Props<S extends Form.Shape, I extends boolean = true> = {
			/** Field name attribute */
			readonly name: ShapeUtil.Name<S>;

			/** Form state */
			readonly state?: (I extends true ? URL : Form.State<S>) | undefined;
		} & Field.Props;

		/** Root element for the Field component */
		export type Root = JSX.IntrinsicElements["div"];

		export namespace Root {
			/** Root for input groups */
			export type Group = JSX.IntrinsicElements["fieldset"];
		}

		/** `<Field.Legend />` component props */
		export type Legend = JSX.IntrinsicElements["legend"];

		/** `<Field.Issue />` component props */
		export type Issue = JSX.IntrinsicElements["p"];

		/**
		 * `<Field.Control />` component props
		 *
		 * @template T Tag name
		 */
		export type Control<T extends Tag> = T extends "textarea"
			? JSX.IntrinsicElements["textarea"]
			: T extends "select"
				? JSX.IntrinsicElements["select"]
				: JSX.IntrinsicElements["input"];

		export namespace Control {
			/**
			 * `<Field.Control />` component props for group input element.
			 *
			 * @template T Tag name
			 * @template V Option values
			 */
			export type Group<T extends Tag, V extends Values> = Control<T> & {
				readonly value: V[number];
			};
		}

		/** `<Field.Label />` component props */
		export type Label = JSX.IntrinsicElements["label"];

		export namespace Label {
			/**
			 * `<Field.Label />` component props for group input element.
			 *
			 * @template V Option values
			 */
			export type Group<V extends Values> = Label & {
				readonly value: V[number];
			};
		}

		/**
		 * `<Field.Option />` select component props
		 *
		 * @template V Values
		 */
		export type Option<V extends Values> = JSX.IntrinsicElements["option"] & {
			/** Option value */
			readonly value: V[number];
		};

		export namespace Option {
			/**
			 * `<Field.Option />` input group component props
			 *
			 * Wrapper for both the `<Label />` and `<Input />` components.
			 *
			 * @template V Values
			 */
			export type Input<V extends Values> = JSX.IntrinsicElements["div"] & {
				/** Option value */
				readonly value: V[number];
			};
		}
	}

	/**
	 * Base Field component object that contains sub-components,
	 * use for fine grained rendering control.
	 *
	 * @template F Field
	 */
	export type Component<F extends Any> = Readonly<
		{
			/**
			 * @param props Issue props
			 * @returns Issue container paragraph
			 */
			Issue: (props?: Component.Issue) => JSX.Element;
		} & (F extends Instance<any, "select", Field.Type, infer V>
			? V extends Values
				? // select
					{
						/** Select option values */
						values: V;

						/**
						 * @param props Root props
						 * @returns Root container div
						 */
						Root: (props?: Component.Root) => JSX.Element;

						/**
						 * @param props Label props
						 * @returns Label element
						 */
						Label: (props?: Component.Label) => JSX.Element;

						/**
						 * @param props Control props
						 * @returns Control select element
						 */
						Control: (props?: Component.Control<"select">) => JSX.Element;

						/**
						 * @param props Option props
						 * @returns Select option element
						 */
						Option: (props: Component.Option<V>) => JSX.Element;
					}
				: never
			: F extends Instance<any, "input", Field.Type, infer V>
				? V extends Values
					? // radio/checkboxes
						{
							/** Input group values */
							values: V;

							/**
							 * @param props Root props
							 * @returns Root container fieldset
							 */
							Root: (props?: Component.Root.Group) => JSX.Element;

							/**
							 * @param props Legend element props
							 * @returns Legend element
							 */
							Legend: (props?: Component.Legend) => JSX.Element;

							/**
							 * @param props Label props including `value`
							 * @returns Label element
							 */
							Label: (props: Component.Label.Group<V>) => JSX.Element;

							/**
							 * @param props Control props
							 * @returns Control input element
							 */
							Control: (
								props?: Component.Control.Group<"input", V>,
							) => JSX.Element;

							/**
							 * @param props Option props
							 * @returns Both label and input elements together
							 */
							Option: (props: Component.Option.Input<V>) => JSX.Element;
						}
					: // regular input
						{
							/**
							 * @param props Root props
							 * @returns Root container div
							 */
							Root: (props?: Component.Root) => JSX.Element;

							/**
							 * @param props Label props
							 * @returns Label element
							 */
							Label: (props?: Component.Label) => JSX.Element;

							/**
							 * @param props Control props
							 * @returns Control input element
							 */
							Control: (props?: Component.Control<"input">) => JSX.Element;
						}
				: // textarea
					{
						/**
						 * @param props Root props
						 * @returns Root container div
						 */
						Root: (props?: Component.Root) => JSX.Element;

						/**
						 * @param props Label props
						 * @returns Label element
						 */
						Label: (props?: Component.Label) => JSX.Element;

						/**
						 * @param props Control props
						 * @returns Control textarea element
						 */
						Control: (props?: Component.Control<"textarea">) => JSX.Element;
					})
	>;

	/** Any field props */
	export type Props = Props.Input | Props.Select | Props.Textarea;

	export namespace Props {
		/** Extra props in addition to HTML attributes */
		interface Meta {
			/** Field label */
			readonly label?: string;
		}

		/** Props for `<input>` fields */
		export type Input = Meta & JSX.IntrinsicElements["input"];

		/** Props for `<select>` fields */
		export type Select = Meta & JSX.IntrinsicElements["select"];

		/** Props for `<textarea>` fields */
		export type Textarea = Meta & JSX.IntrinsicElements["textarea"];
	}
}

/** Field factory functions */
export class Field {
	// this is used instead of the defaults for example "Expected string"
	// since "string" doesn't make sense to end users
	/** Default message for required field values. */
	static readonly #required = "Required field";
	/**
	 * Message for choices, whether none or one not offered was sent, such as
	 * by an agent, where "Required field" would be wrong.
	 */
	static readonly #choose = "Select an option";

	/**
	 * @param value Raw form entry
	 * @returns `true` when the file input contains a real file value
	 */
	static #nonEmptyFile(value: FormDataEntryValue | null) {
		return value instanceof File && (value.name !== "" || value.size > 0);
	}

	/**
	 * @param data Form data
	 * @param name HTML name attribute
	 * @returns Field values or `undefined` when missing
	 */
	static #readMany(data: FormData | URLSearchParams, name: string) {
		const value = data.getAll(name);

		return value.length ? value : undefined;
	}

	/**
	 * @param props Input props
	 * @returns Generic input field
	 */
	static #input<T extends Field.Type>(
		props: Field.Props.Input & { type: T },
	): Field.Instance<string, "input", T> {
		return new FieldSchema({ props }, Schema.string(Field.#required));
	}

	/**
	 * @param props Input props
	 * @returns Text input field
	 */
	static text(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "text"> {
		return Field.#input({ ...props, type: "text" });
	}

	/**
	 * @param props Input props
	 * @returns Password input field
	 */
	static password(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "password"> {
		return Field.#input({ ...props, type: "password" });
	}

	/**
	 * @param props Input props
	 * @returns Search input field
	 */
	static search(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "search"> {
		return Field.#input({ ...props, type: "search" });
	}

	/**
	 * @param props Input props
	 * @returns Telephone input field
	 */
	static tel(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "tel"> {
		return Field.#input({ ...props, type: "tel" });
	}

	/**
	 * @param props Input props
	 * @returns Color input field
	 */
	static color(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "color"> {
		return Field.#input({ ...props, type: "color" });
	}

	/**
	 * @param props Input props
	 * @returns Hidden input field
	 */
	static hidden(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "hidden"> {
		return Field.#input({ ...props, type: "hidden" });
	}

	/**
	 * @param props Input props
	 * @returns Date input field
	 */
	static date(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "date"> {
		return Field.#input({ ...props, type: "date" });
	}

	/**
	 * @param props Input props
	 * @returns Datetime input field
	 */
	static datetime(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "datetime-local"> {
		return Field.#input({ ...props, type: "datetime-local" });
	}

	/**
	 * @param props Input props
	 * @returns Month input field
	 */
	static month(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "month"> {
		return Field.#input({ ...props, type: "month" });
	}

	/**
	 * @param props Input props
	 * @returns Week input field
	 */
	static week(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "week"> {
		return Field.#input({ ...props, type: "week" });
	}

	/**
	 * @param props Input props
	 * @returns Time input field
	 */
	static time(
		props?: Field.Props.Input,
	): Field.Instance<string, "input", "time"> {
		return Field.#input({ ...props, type: "time" });
	}

	/**
	 * Validates email string.
	 *
	 * @param props Input props
	 * @param message Issue message when invalid
	 * @returns Email input field
	 */
	static email(
		props?: Field.Props.Input,
		message?: string,
	): Field.Instance<string, "input", "email"> {
		return new FieldSchema(
			{ props: { ...props, type: "email" } },
			Schema.string(Field.#required).email(message),
		);
	}

	/**
	 * Validates parsable URL.
	 *
	 * @param props Input props
	 * @param message Issue message when invalid
	 * @returns URL input field
	 */
	static url(
		props?: Field.Props.Input,
		message?: string,
	): Field.Instance<string, "input", "url"> {
		return new FieldSchema(
			{ props: { ...props, type: "url" } },
			Schema.string(Field.#required).url(message),
		);
	}

	/**
	 * @param props Input props
	 * @returns Input field
	 */
	static #number<T extends "number" | "range">(
		props: Field.Props.Input & { type: T },
	): Field.Instance<number, "input", T> {
		return new FieldSchema(
			{ props },
			Schema.number(Field.#required).preprocess(Field.#toNumber),
		);
	}

	/**
	 * @param value Form entry or stored number
	 * @returns The number to validate
	 */
	static #toNumber(value: unknown) {
		// form submissions read numeric controls as strings
		if (value == null || value === "") return undefined;

		const number = Number(value);

		// integers beyond 2^53 were or would be rounded, left as text to fail validation
		return Number.isInteger(number) && !Number.isSafeInteger(number)
			? String(value)
			: number;
	}

	static {
		normalizers.add(Field.#toNumber);
	}

	/**
	 * Coerces to number.
	 *
	 * @param props Input props
	 * @returns Number input field
	 */
	static number(
		props?: Field.Props.Input,
	): Field.Instance<number, "input", "number"> {
		return Field.#number({ ...props, type: "number" });
	}

	/**
	 * Coerces to number.
	 *
	 * @param props Input props
	 * @returns Range input field
	 */
	static range(
		props?: Field.Props.Input,
	): Field.Instance<number, "input", "range"> {
		return Field.#number({ ...props, type: "range" });
	}

	/**
	 * - unchecked => key missing => `false`
	 * - checked => key present => `true`
	 *
	 * @param props Input props
	 * @returns Checkbox input field
	 */
	static checkbox(
		props?: Field.Props.Input,
	): Field.Instance<boolean, "input", "checkbox"> {
		return new FieldSchema(
			{ props: { ...props, type: "checkbox" } },
			Schema.boolean(),
			(formData, name) => formData.has(name),
		);
	}

	/**
	 * @param props Input props
	 * @returns File input field
	 */
	static file(
		props?: Field.Props.Input,
	): Field.Instance<File, "input", "file"> {
		return new FieldSchema(
			{ props: { ...props, type: "file" } },
			Schema.instance(File, Field.#required),
			(data, name) => {
				const value = data.get(name);

				return (Field.#nonEmptyFile(value) && value) || undefined;
			},
		);
	}

	/**
	 * @param props Input props
	 * @returns Multiple file input field
	 */
	static files(
		props?: Field.Props.Input,
	): Field.Instance<File[], "input", "file"> {
		return new FieldSchema(
			{ props: { ...props, type: "file", multiple: true } },
			Schema.array(Schema.instance(File, Field.#required), Field.#required),
			(data, name) => {
				const value = data.getAll(name).filter(Field.#nonEmptyFile);

				return value.length ? value : undefined;
			},
			Infinity,
		);
	}

	/**
	 * @template V Value type
	 * @param values Checkbox values
	 * @param props Input props
	 * @returns Checkbox group input field
	 */
	static checkboxes<const V extends string>(
		values: readonly [V, ...V[]],
		props?: Field.Props.Input,
	): Field.Instance<V[], "input", "checkbox", readonly [V, ...V[]]> {
		return new FieldSchema(
			{ values, props: { ...props, type: "checkbox" } },
			Schema.array(Schema.enum(values, Field.#choose), Field.#choose),
			Field.#readMany,
			values.length,
		);
	}

	/**
	 * @template V Value type
	 * @param values Radio button values
	 * @param props Input props
	 * @returns Radio group input field
	 */
	static radio<const V extends string>(
		values: readonly [V, ...V[]],
		props?: Field.Props.Input,
	): Field.Instance<V, "input", "radio", readonly [V, ...V[]]> {
		return new FieldSchema(
			{ values, props: { ...props, type: "radio" } },
			Schema.enum(values, Field.#choose),
		);
	}

	/**
	 * @param props Textarea props
	 * @returns Textarea field
	 */
	static textarea(
		props?: Field.Props.Textarea,
	): Field.Instance<string, "textarea"> {
		return new FieldSchema(
			{ tag: "textarea", props },
			Schema.string(Field.#required),
		);
	}

	/**
	 * @template V Value type
	 * @param values Select options
	 * @param props Select props
	 * @returns Select field
	 */
	static select<const V extends string>(
		values: readonly [V, ...V[]],
		props?: Field.Props.Select,
	): Field.Instance<V, "select", Field.Type, readonly [V, ...V[]]> {
		return new FieldSchema(
			{ tag: "select", values, props },
			Schema.enum(values, Field.#choose),
		);
	}

	/**
	 * @template V Value type
	 * @param values Select options
	 * @param props Select props
	 * @returns Multi-select field
	 */
	static multiselect<const V extends string>(
		values: readonly [V, ...V[]],
		props?: Field.Props.Select,
	): Field.Instance<V[], "select", Field.Type, readonly [V, ...V[]]> {
		return new FieldSchema(
			{ tag: "select", values, props: { ...props, multiple: true } },
			Schema.array(Schema.enum(values, Field.#choose), Field.#choose),
			Field.#readMany,
			values.length,
		);
	}
}
