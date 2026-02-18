import { type JSX, jsx } from "../jsx/index.js";
import { Checksum, Codec } from "../util/index.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

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
		 */
		export type Result<O, M extends object = {}> = Valid<O> | (Invalid & M);

		/**
		 * Type of constructor input (path is required).
		 *
		 * @template O Parse output
		 * @param value Unknown value to parse
		 * @param path Issue path (internal)
		 * @returns Parse result containing data or issues
		 */
		export type Constructor<O> = (
			value: unknown,
			path: Issue.Path,
		) => Result<O>;
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
				? // infer value of each schema (value) in the shape
					{ [K in keyof S]: Infer<S[K]> }
				: never;

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
	export type Object<S extends Object.Shape> = ObjectSchema<S>;

	export namespace Object {
		/** Object schema shape. */
		export type Shape = Record<string, Schema<unknown>>;
	}

	/**
	 * Schema.Form instance type
	 *
	 * @template S Form shape type
	 */
	export type Form<S extends Form.Shape = Form.Shape> = FormSchema<S>;

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
				Record<Shape.Name<S>, Value>
			>;
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

		export namespace State {
			/**
			 * Form state input.
			 *
			 * Can be the actual state or the encoded URL like object.
			 *
			 * @template S Shape type
			 */
			export type Input<S extends Shape = Shape> =
				| State<S>
				| URL
				| URLSearchParams
				| string;
		}

		export namespace Parse {
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
				Schema.Infer<S>,
				{
					/** Encoded URL search param field state */
					readonly search: Result.Search;
				} & M
			>;

			export namespace Result {
				/** Form search param key/value */
				export type Search = ["_form", string] | undefined;
			}
		}
	}
}

/** @internal Shared shape types for `Shape` related runtime methods. */
namespace Shape {
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

/** @internal Shared runtime shape operations used by object and form schema methods. */
class Shape {
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
	>(shape: S, extra: E): Shape.Extend<S, E> {
		return { ...shape, ...extra } as Shape.Extend<S, E>;
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
	static pick<S extends Record<string, unknown>, N extends Shape.Name<S>>(
		shape: S,
		names: readonly [N, ...N[]],
	): Pick<S, N> {
		const out: Record<string, unknown> = {};

		for (const name of names) {
			if (name in shape) out[name] = shape[name];
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
	static omit<S extends Record<string, unknown>, N extends Shape.Name<S>>(
		shape: S,
		names: readonly [N, ...N[]],
	): Omit<S, N> {
		const remove = new Set<string>(names);
		const out: Record<string, unknown> = {};

		for (const [name, value] of Object.entries(shape)) {
			if (!remove.has(name)) out[name] = value;
		}

		return out as Omit<S, N>;
	}
}

/**
 * Minimal schema validator geared around parsing multipart `FormData`.
 *
 * Implements Standard Schema v1 via the `~standard` property (sync validate).
 *
 * @template Output Output type after parsing
 * @template Input Input type expected (defaults to unknown)
 */
export class Schema<Output, Input = unknown> implements StandardSchemaV1<
	Input,
	Output
> {
	/** Email regular expression */
	static readonly #emailRegex =
		/^(?!\.)(?!.*\.\.)([a-z0-9_'+\-\.]*)[a-z0-9_'+\-]@([a-z0-9][a-z0-9\-]*\.)+[a-z]{2,}$/i;

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

		/**
		 * Create a new AggregateIssue.
		 *
		 * Coerces issues into a non-empty tuple.
		 *
		 * @param issues Issues
		 */
		constructor([first, ...rest]: Schema.Issue[]) {
			if (!first) throw new TypeError("AggregateIssue must have an issue.");

			const issues: Schema.Issue.List = [first, ...rest];
			const name = "Schema.AggregateIssue";
			const count = issues.length;

			super(issues, `${name}(${count})\n${issues.join("\n")}`);

			this.name = name;
			this.issues = issues;
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

	readonly "~standard" = {
		version: 1,
		vendor: "ovr",
		validate: (value: unknown) => {
			const result = this.parse(value);

			return result.issues ? result : { value: result.data };
		},
	} as const;

	/**
	 * Parse and validate an unknown value.
	 *
	 * @param value Unknown value to parse
	 * @param path Optional issue path (internal)
	 * @returns Parse result containing data or issues
	 */
	parse: Schema.Parse<Output>;

	/**
	 * Construct a new schema - used internally.
	 *
	 * Use static methods on `Schema` to make a new schema.
	 *
	 * @param parse Parse function that validates and transforms input
	 */
	constructor(parse: Schema.Parse.Constructor<Output>) {
		this.parse = (value, path = []) => parse(value, path);
	}

	/**
	 * @internal Required for Field to override and return a `Field` instance
	 * from the chained methods instead of a `Schema`
	 * @template O Output type of the new schema
	 * @param parse Parse function that validates and transforms input
	 * @returns New schema instance based on the current instance
	 */
	derive<O>(parse: Schema.Parse.Constructor<O>) {
		return new Schema<O, Input>(parse);
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
	>(this: Field<Output, T, U, V>): Field<Output | undefined, T, U, V>;
	/**
	 * @returns Optional schema
	 */
	optional(this: Schema<Output, Input>): Schema<Output | undefined, Input>;
	optional(this: Schema<Output, Input>) {
		return this.derive((v, path) => {
			if (v === undefined) return { data: v as Output | undefined };

			return this.parse(v, path);
		});
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
	>(this: Field<Output, T, U, V>): Field<Output | null, T, U, V>;
	/**
	 * @returns Nullable schema
	 */
	nullable(this: Schema<Output, Input>): Schema<Output | null, Input>;
	nullable(this: Schema<Output, Input>) {
		return this.derive((v, path) => {
			if (v === null) return { data: v as Output | null };

			return this.parse(v, path);
		});
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
	>(this: Field<Output, T, U, V>): Field<Output | null | undefined, T, U, V>;
	/**
	 * @returns Nullish schema
	 */
	nullish(
		this: Schema<Output, Input>,
	): Schema<Output | null | undefined, Input>;
	nullish(this: Schema<Output, Input>) {
		return this.derive((v, path) => {
			if (v == null) return { data: v as Output | null | undefined };

			return this.parse(v, path);
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
	>(this: Field<Output, T, U, V>, value: Output): Field<Output, T, U, V>;
	/**
	 * @param value Default value to use when input is undefined
	 * @returns Schema with default
	 */
	default(this: Schema<Output, Input>, value: Output): Schema<Output, Input>;
	default(this: Schema<Output, Input>, value: Output) {
		return this.derive((v, path) => {
			if (v === undefined) return { data: value };

			return this.parse(v, path);
		});
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
	>(this: Field<Output, T, U, V>, fn: (value: Output) => O): Field<O, T, U, V>;
	/**
	 * @template O Output type after transformation
	 * @param fn Transform function to apply to parsed output
	 * @returns Transformed schema
	 */
	transform<O>(
		this: Schema<Output, Input>,
		fn: (value: Output) => O,
	): Schema<O, Input>;
	transform<O>(this: Schema<Output, Input>, fn: (value: Output) => O) {
		return this.derive((v, path) => {
			const out = this.parse(v, path);

			return out.issues ? out : { data: fn(out.data) };
		});
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
	>(this: Field<Output, T, U, V>, next: Schema<O>): Field<O, T, U, V>;
	/**
	 * @template O Output type after pipe
	 * @param next Schema to validate the result with
	 * @returns Piped schema
	 */
	pipe<O>(this: Schema<Output, Input>, next: Schema<O>): Schema<O, Input>;
	pipe<O>(this: Schema<Output, Input>, next: Schema<O>) {
		return this.derive((v, path) => {
			const result = this.parse(v, path);

			return result.issues ? result : next.parse(result.data, path);
		});
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
		this: Field<Output, T, U, V>,
		check: (value: Output) => boolean,
		message: string,
	): Field<Output, T, U, V>;
	/**
	 * @param check Validation function that returns `false` to fail
	 * @param message Issue message when invalid
	 * @returns Refined schema
	 */
	refine(
		this: Schema<Output, Input>,
		check: (value: Output) => boolean,
		message: string,
	): Schema<Output, Input>;
	refine(
		this: Schema<Output, Input>,
		check: (value: Output) => boolean,
		message: string,
	) {
		return this.derive((v, path) => {
			const out = this.parse(v, path);

			return out.issues || check(out.data)
				? out
				: new Schema.AggregateIssue([
						new Schema.Issue("refine", path, message),
					]);
		});
	}

	/**
	 * Accepts any value and presents the data as `unknown`.
	 *
	 * @returns Unknown schema
	 */
	static unknown() {
		return new Schema((v) => ({ data: v }));
	}

	/**
	 * Validate an input is a string.
	 *
	 * @param message Issue message when invalid
	 * @returns String schema
	 */
	static string(message?: string) {
		return new Schema((v, path) => {
			return typeof v === "string"
				? { data: v }
				: new Schema.AggregateIssue([
						new Schema.Issue("string", path, message),
					]);
		});
	}

	/**
	 * Parse a JSON string and validate the parsed value with the provided schema.
	 *
	 * @template O Output type
	 * @param schema Schema to validate the parsed JSON value with
	 * @param message Issue message when invalid
	 * @returns Parsed JSON schema
	 */
	static json<const O>(schema: Schema<O>, message?: string) {
		return Schema.string(message).pipe(
			new Schema((v, path) => {
				let data: unknown;

				try {
					data = JSON.parse(v as string);
				} catch {
					return new Schema.AggregateIssue([
						new Schema.Issue("JSON", path, message),
					]);
				}

				return schema.parse(data, path);
			}),
		);
	}

	/**
	 * Validate an input is a valid email string using
	 * [Reasonable Email Regex by Colin McDonnell](https://colinhacks.com/essays/reasonable-email-regex).
	 *
	 * @param message Issue message when invalid
	 * @returns Email schema
	 */
	static email(message = "Expected email") {
		return Schema.string().refine((s) => {
			try {
				return Schema.#emailRegex.test(s);
			} catch {
				return false;
			}
		}, message);
	}

	/**
	 * Validate an input is a valid URL string.
	 *
	 * @param message Issue message when invalid
	 * @returns URL schema
	 */
	static url(message = "Expected URL") {
		return Schema.string().refine(URL.canParse, message);
	}

	/**
	 * Validate an input is a `true` or `false` boolean.
	 *
	 * @param message Issue message when invalid
	 * @returns Boolean schema
	 */
	static boolean(message?: string) {
		return new Schema((v, path) => {
			return typeof v === "boolean"
				? { data: v }
				: new Schema.AggregateIssue([
						new Schema.Issue("boolean", path, message),
					]);
		});
	}

	/**
	 * Validate an input is a number.
	 *
	 * Rejects `NaN`.
	 *
	 * @param message Issue message when invalid
	 * @returns Number schema
	 */
	static number(message?: string) {
		return new Schema((v, path) => {
			return typeof v === "number" && !Number.isNaN(v)
				? { data: v }
				: new Schema.AggregateIssue([
						new Schema.Issue("number", path, message),
					]);
		});
	}

	/**
	 * Validate an input is a safe integer.
	 *
	 * @param message Issue message when invalid
	 * @returns Integer schema
	 */
	static int(message = "Expected integer") {
		return Schema.number().refine(Number.isSafeInteger, message);
	}

	/**
	 * Validate an input is a big integer.
	 *
	 * @param message Issue message when invalid
	 * @returns Big integer schema
	 */
	static bigint(message?: string) {
		return new Schema((v, path) => {
			return typeof v === "bigint"
				? { data: v }
				: new Schema.AggregateIssue([
						new Schema.Issue("bigint", path, message),
					]);
		});
	}

	/**
	 * Validate an input is a `Date`.
	 *
	 * Rejects invalid dates.
	 *
	 * @param message Issue message when invalid
	 * @returns Date schema
	 */
	static date(message = "Expected valid date") {
		return Schema.instance(Date).refine(
			(v) => !Number.isNaN(v.getTime()),
			message,
		);
	}

	/**
	 * @template L Literal type
	 * @param literal Exact value to match
	 * @param message Issue message when invalid
	 * @returns Literal schema
	 */
	static literal<const L>(literal: L, message?: string) {
		return new Schema((v, path) => {
			return v === literal
				? { data: literal }
				: new Schema.AggregateIssue([new Schema.Issue(literal, path, message)]);
		});
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
		return new Schema<A[number]>((v, path) => {
			for (const a of allowed) {
				if (v === a) return { data: a };
			}

			return new Schema.AggregateIssue([
				new Schema.Issue(
					allowed.map((v) => JSON.stringify(v)).join(" | "),
					path,
					message,
				),
			]);
		});
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
		return new Schema((v, path) => {
			const issues: Schema.Issue[] = [];

			for (const schema of schemas) {
				const result = schema.parse(v, path);

				if (!result.issues) {
					// return as soon as one passes
					return result as Schema.Parse.Result<Schema.Infer<S[number]>>;
				}

				issues.push(...result.issues);
			}

			return new Schema.AggregateIssue(issues);
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
	static instance<const O>(
		constructor: new (...args: any[]) => O,
		message?: string,
	) {
		return new Schema((v, path) =>
			v instanceof constructor
				? { data: v }
				: new Schema.AggregateIssue([
						new Schema.Issue(constructor.name, path, message),
					]),
		);
	}

	/**
	 * Validates that the input is a `File` instance.
	 *
	 * @param message Issue message when invalid
	 * @returns File schema
	 */
	static file(message?: string) {
		return Schema.instance(File, message);
	}

	/**
	 * Validates that the input is an array and parses each item.
	 *
	 * @template O Output type
	 * @param schema Schema for each array item
	 * @param message Issue message when invalid
	 * @returns Array schema
	 */
	static array<const O>(schema: Schema<O>, message?: string) {
		return new Schema((v, path) => {
			if (!Array.isArray(v)) {
				return new Schema.AggregateIssue([
					new Schema.Issue("Array", path, message),
				]);
			}

			const data: O[] = [];
			const issues: Schema.Issue[] = [];

			for (let i = 0; i < v.length; i++) {
				const result = schema.parse(v[i], [...path, i]);

				if (result.issues) {
					issues.push(...result.issues);
				} else {
					data.push(result.data);
				}
			}

			if (issues.length) return new Schema.AggregateIssue(issues);

			return { data };
		});
	}

	/**
	 * Validates each key in the shape and returns a new object of parsed outputs.
	 *
	 * @template S Object shape type
	 * @param shape Object shape with schemas for each key
	 * @returns Object schema
	 */
	static object<const S extends Schema.Object.Shape>(
		shape: S,
	): Schema.Object<S>;
	/**
	 * Validate an input is a non-null object.
	 *
	 * @returns Object schema
	 */
	static object(): Schema<Record<string, unknown>>;
	static object<const S extends Schema.Object.Shape>(
		shape?: S,
	): Schema.Object<S> | Schema<Record<string, unknown>> {
		if (!shape) {
			return new Schema((v, path) =>
				v != null && typeof v === "object" && !Array.isArray(v)
					? { data: v as Record<string, unknown> }
					: new Schema.AggregateIssue([new Schema.Issue("Object", path)]),
			);
		}

		return new Schema.Object(shape);
	}

	/**
	 * Form schema with JSX rendering capabilities.
	 *
	 * Parses `FormData` and generates form field components.
	 *
	 * @template S Form field shape type
	 * @param fields Form fields
	 */
	static form<const S extends Schema.Form.Shape>(
		fields: S | Schema.Form<S>,
	): Schema.Form<S> {
		return fields instanceof Schema.Form ? fields : new Schema.Form(fields);
	}

	/**
	 * Runtime constructor for object schemas.
	 */
	static get Object(): typeof ObjectSchema {
		return ObjectSchema;
	}

	/** Coercion schemas that apply JavaScript type coercion before validation. */
	static readonly Coerce = class Coerce {
		/**
		 * Coerce to string using `String(value)`.
		 *
		 * @returns Coerced string schema
		 */
		static string() {
			return new Schema((v) => ({ data: String(v) }));
		}

		/**
		 * Coerce to number using `Number(value)`.
		 *
		 * @returns Coerced number schema
		 */
		static number() {
			return new Schema((v) => ({ data: Number(v) }));
		}

		/**
		 * Coerce to bigint using `BigInt(value)`.
		 *
		 * @param message Issue message when invalid
		 * @returns Coerced big integer schema
		 */
		static bigint(message?: string) {
			return new Schema((v, path) => {
				try {
					return {
						data: BigInt(v as any), // catch input error
					};
				} catch {
					return new Schema.AggregateIssue([
						new Schema.Issue(
							"string | number | bigint | boolean",
							path,
							message,
						),
					]);
				}
			});
		}

		/**
		 * Coerce to boolean using `Boolean(value)`.
		 *
		 * @returns Coerced boolean schema
		 */
		static boolean() {
			return new Schema((v) => ({ data: Boolean(v) }));
		}

		/**
		 * Coerce to Date using `new Date(value)`. Rejects invalid dates.
		 *
		 * @param message Issue message when invalid
		 * @returns Coerced date schema
		 */
		static date(message?: string) {
			return new Schema((v, path) =>
				Schema.date(message).parse(new Date(String(v)), path),
			);
		}
	};

	/** Field factory functions */
	static readonly Field = class FieldFactory {
		/**
		 * @param props Input props
		 * @returns Generic input field
		 */
		static #input(props: Field.Props.Input & { type: Field.Type }) {
			return new Field({ props }, Schema.Coerce.string());
		}

		/**
		 * @param props Input props
		 * @returns Text input field
		 */
		static text(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "text" });
		}

		/**
		 * @param props Input props
		 * @returns Password input field
		 */
		static password(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "password" });
		}

		/**
		 * @param props Input props
		 * @returns Search input field
		 */
		static search(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "search" });
		}

		/**
		 * @param props Input props
		 * @returns Telephone input field
		 */
		static tel(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "tel" });
		}

		/**
		 * @param props Input props
		 * @returns Color input field
		 */
		static color(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "color" });
		}

		/**
		 * @param props Input props
		 * @returns Hidden input field
		 */
		static hidden(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "hidden" });
		}

		/**
		 * @param props Input props
		 * @param message Issue message when invalid
		 * @returns Date input field
		 */
		static date(props?: Field.Props.Input, message = "Expected valid date") {
			return FieldFactory.#input({ ...props, type: "date" }).refine(
				(v) => Boolean(Schema.Coerce.date().parse(v).data), // checks if string is valid
				message,
			);
		}

		/**
		 * @param props Input props
		 * @returns Datetime input field
		 */
		static datetime(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "datetime-local" });
		}

		/**
		 * @param props Input props
		 * @returns Month input field
		 */
		static month(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "month" });
		}

		/**
		 * @param props Input props
		 * @returns Week input field
		 */
		static week(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "week" });
		}

		/**
		 * @param props Input props
		 * @returns Time input field
		 */
		static time(props?: Field.Props.Input) {
			return FieldFactory.#input({ ...props, type: "time" });
		}

		/**
		 * Validates email string.
		 *
		 * @param props Input props
		 * @param message Issue message when invalid
		 * @returns Email input field
		 */
		static email(props?: Field.Props.Input, message?: string) {
			return new Field(
				{ props: { ...props, type: "email" } },
				Schema.email(message),
			);
		}

		/**
		 * Validates parsable URL.
		 *
		 * @param props Input props
		 * @param message Issue message when invalid
		 * @returns URL input field
		 */
		static url(props?: Field.Props.Input, message?: string) {
			return new Field(
				{ props: { ...props, type: "url" } },
				Schema.url(message),
			);
		}

		/**
		 * @param props Input props
		 * @returns Input field
		 */
		static #number(props: Field.Props.Input & { type: "number" | "range" }) {
			return new Field({ props }, Schema.Coerce.number());
		}

		/**
		 * Coerces to number.
		 *
		 * @param props Input props
		 * @returns Number input field
		 */
		static number(props?: Field.Props.Input) {
			return FieldFactory.#number({ ...props, type: "number" });
		}

		/**
		 * Coerces to number.
		 *
		 * @param props Input props
		 * @returns Range input field
		 */
		static range(props?: Field.Props.Input) {
			return FieldFactory.#number({ ...props, type: "range" });
		}

		/**
		 * - unchecked => key missing => `false`
		 * - checked => key present => `true`
		 *
		 * @param props Input props
		 * @returns Checkbox input field
		 */
		static checkbox(props?: Field.Props.Input) {
			return new Field(
				{ props: { ...props, type: "checkbox" } },
				Schema.Coerce.boolean(),
				(formData, name) => formData.has(name),
			);
		}

		/**
		 * @param props Input props
		 * @param message Issue message when invalid
		 * @returns File input field
		 */
		static file(props?: Field.Props.Input, message?: string) {
			return new Field(
				{ props: { ...props, type: "file" } },
				Schema.file(message),
			);
		}

		/**
		 * @param props Input props
		 * @param message Issue message when invalid
		 * @returns Multiple file input field
		 */
		static files(props?: Field.Props.Input, message?: string) {
			return new Field(
				{ props: { ...props, type: "file", multiple: true } },
				Schema.array(Schema.file(message)),
				(formData, name) => formData.getAll(name),
			);
		}

		/**
		 * @template V Value type
		 * @param values Checkbox values
		 * @param props Input props
		 * @param message Issue message when invalid
		 * @returns Checkbox group input field
		 */
		static checkboxes<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Field.Props.Input,
			message?: string,
		) {
			return new Field(
				{ values, props: { ...props, type: "checkbox" } },
				Schema.array(Schema.enum(values, message)),
				(formData, name) => formData.getAll(name),
			);
		}

		/**
		 * @template V Value type
		 * @param values Radio button values
		 * @param props Input props
		 * @param message Issue message when invalid
		 * @returns Radio group input field
		 */
		static radio<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Field.Props.Input,
			message?: string,
		) {
			return new Field(
				{ values, props: { ...props, type: "radio" } },
				Schema.enum(values, message),
			);
		}

		/**
		 * @param props Textarea props
		 * @returns Textarea field
		 */
		static textarea(props?: Field.Props.Textarea) {
			return new Field({ tag: "textarea", props }, Schema.Coerce.string());
		}

		/**
		 * @template V Value type
		 * @param values Select options
		 * @param props Select props
		 * @param message Issue message when invalid
		 * @returns Select field
		 */
		static select<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Field.Props.Select,
			message?: string,
		) {
			return new Field(
				{ tag: "select", values, props },
				Schema.enum(values, message),
			);
		}

		/**
		 * @template V Value type
		 * @param values Select options
		 * @param props Select props
		 * @param message Issue message when invalid
		 * @returns Multi-select field
		 */
		static multiselect<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Field.Props.Select,
			message?: string,
		) {
			return new Field(
				{ tag: "select", values, props: { ...props, multiple: true } },
				Schema.array(Schema.enum(values, message)),
				(formData, name) => formData.getAll(name),
			);
		}
	};

	/** Runtime constructor for form schemas. */
	static get Form(): typeof FormSchema {
		return FormSchema;
	}
}

/**
 * Runtime object schema that validates plain objects and supports shape helpers.
 *
 * @template Shape Object shape type
 */
export class ObjectSchema<
	const Shape extends Schema.Object.Shape,
> extends Schema<Schema.Infer<Shape>> {
	/** Object shape definitions. */
	readonly #shape: Shape;

	/**
	 * Create a new object schema validator.
	 *
	 * @param shape Object shape
	 */
	constructor(shape: Shape) {
		super((value, path) => {
			const input = Schema.object().parse(value);

			if (input.issues) return input;

			const data: Record<string, unknown> = {};
			const issues: Schema.Issue[] = [];

			for (const [name, schema] of Object.entries(shape)) {
				const result = schema.parse(input.data[name], [...path, name]);

				if (result.issues) {
					issues.push(...result.issues);
				} else {
					data[name] = result.data;
				}
			}

			return issues.length
				? new Schema.AggregateIssue(issues)
				: ({ data } as { data: Schema.Infer<Shape> });
		});

		this.#shape = shape;
	}

	/**
	 * Returns a new object schema with `extra` merged into the current shape.
	 *
	 * @template E Extra shape type
	 * @param extra Extra shape to merge
	 */
	extend<const E extends Schema.Object.Shape>(
		extra: E,
	): Schema.Object<Shape.Extend<Shape, E>> {
		return Schema.object(Shape.extend(this.#shape, extra));
	}

	/**
	 * Returns a new object schema with only the selected field names.
	 *
	 * @template N Selected key names
	 * @param names Non-empty list of key names to keep
	 */
	pick<const N extends Shape.Name<Shape>>(names: readonly [N, ...N[]]) {
		return Schema.object(Shape.pick(this.#shape, names));
	}

	/**
	 * Returns a new object schema without the selected field names.
	 *
	 * @template N Removed key names
	 * @param names Non-empty list of key names to remove
	 */
	omit<const N extends Shape.Name<Shape>>(names: readonly [N, ...N[]]) {
		return Schema.object(Shape.omit(this.#shape, names));
	}
}

/**
 * Runtime form schema with parsing, encoded state handling, and field rendering.
 *
 * @template Shape Form field shape type
 */
export class FormSchema<const Shape extends Schema.Form.Shape> {
	/** Form state param key. */
	static readonly #param = "_form";

	/** Maximum encoded state size in bytes. */
	static readonly #maxStateBytes = 4096;

	/** Maximum serialized size for a single persisted value. */
	static readonly #maxValueChars = 512;

	/** Schema used to validate persisted form values. */
	static readonly #valueSchema = Schema.union([
		Schema.string(),
		Schema.number(),
		Schema.boolean(),
		Schema.array(Schema.string()),
	]);

	/** Field definitions. */
	readonly #fields: Shape;

	/** Field names in definition order. */
	readonly #names: Shape.Name<Shape>[];

	/** Form id. */
	readonly #id: string;

	/**
	 * Create a new form schema validator.
	 *
	 * @param fields Form fields
	 */
	constructor(fields: Shape) {
		this.#fields = fields;
		this.#names = Object.keys(this.#fields) as Shape.Name<Shape>[];
		this.#id = Checksum.djb2(this.#names.join());
	}

	/**
	 * Returns a new form schema with `extra` merged into the current fields.
	 *
	 * @template E Extra field shape type
	 * @param extra Extra fields to merge
	 */
	extend<const E extends Schema.Form.Shape>(
		extra: E,
	): Schema.Form<Shape.Extend<Shape, E>> {
		return Schema.form(Shape.extend(this.#fields, extra));
	}

	/**
	 * Returns a new form schema with only the selected field names.
	 *
	 * @template N Selected field names
	 * @param names Non-empty list of field names to keep
	 */
	pick<const N extends Shape.Name<Shape>>(names: readonly [N, ...N[]]) {
		return Schema.form(Shape.pick(this.#fields, names));
	}

	/**
	 * Returns a new form schema without the selected field names.
	 *
	 * @template N Field names to remove
	 * @param names Non-empty list of field names to remove
	 */
	omit<const N extends Shape.Name<Shape>>(names: readonly [N, ...N[]]) {
		return Schema.form(Shape.omit(this.#fields, names));
	}

	/**
	 * Determines whether a field value may be persisted in encoded form state.
	 *
	 * Password and file inputs are intentionally excluded.
	 *
	 * @param field Field definition
	 * @returns `true` when the field value can be persisted
	 */
	static #persist(field: Field.Any) {
		return field.type !== "password" && field.type !== "file";
	}

	/**
	 * Sanitizes persisted values by removing unsupported or oversized entries.
	 *
	 * @param values Candidate values to persist
	 * @returns Sanitized values
	 */
	#sanitize(values?: Record<string, unknown>) {
		const sanitized: Schema.Form.Value.Map<Shape> = {};

		if (values) {
			for (const [name, value] of Object.entries(values)) {
				const field = this.#fields[name];

				if (field && FormSchema.#persist(field) && value != null) {
					const result = FormSchema.#valueSchema.parse(value);

					if (
						!result.issues &&
						JSON.stringify(result.data).length <= FormSchema.#maxValueChars
					) {
						sanitized[name as Shape.Name<Shape>] = result.data;
					}
				}
			}

			if (Object.keys(sanitized).length) return sanitized;
		}
	}

	/**
	 * Decode form state from input.
	 *
	 * @param stateInput URL, URLSearchParams, encoded string, or state
	 */
	#decode(
		stateInput?: Schema.Form.State.Input<Shape>,
	): Schema.Form.State<Shape> | undefined {
		if (stateInput) {
			let state: Schema.Form.State<Shape> | undefined;

			// const stateSchema = Schema.json(
			// 	Schema.object({
			// 		id: Schema.literal(this.#id),
			// 		issues: Schema.array(Schema.object()),
			// 		values: Schema.object({})
			// 	}),
			// );

			if (typeof stateInput === "object" && "id" in stateInput) {
				state = stateInput;
			} else {
				const encoded =
					typeof stateInput === "string"
						? stateInput
						: stateInput instanceof URL
							? stateInput.searchParams.get(FormSchema.#param)
							: stateInput.get(FormSchema.#param);

				if (encoded && encoded.length <= FormSchema.#maxStateBytes * 2) {
					try {
						state = JSON.parse(Codec.decode(Codec.Base64Url.decode(encoded)));
					} catch {}
				}
			}

			if (state?.id === this.#id) {
				return { ...state, values: this.#sanitize(state.values) };
			}
		}
	}

	/**
	 * Parse and validate FormData.
	 *
	 * @param formData FormData to parse
	 * @param path Internal path reference
	 * @returns Parsed result
	 */
	parse = (
		formData: FormData,
		path: Schema.Issue.Path = [],
	): Schema.Form.Parse.Result<Shape> => {
		const data: Record<string, unknown> = {};
		const issues: Schema.Issue[] = [];
		const values: Record<string, unknown> = {};

		for (const [name, field] of Object.entries(this.#fields)) {
			const value = field.read(formData, name);
			const result = field.parse(value, [...path, name]);

			if (result.issues) {
				issues.push(...result.issues);
			} else {
				data[name] = result.data;
			}

			if (FormSchema.#persist(field) && value != null) values[name] = value;
		}

		if (issues.length) {
			const result = new Schema.AggregateIssue(issues);
			const sanitized = this.#sanitize(values);
			let search: Schema.Form.Parse.Result.Search;

			if (sanitized) {
				// encode into search
				const len = this.#names.length;

				for (let i = len; i >= 0; i--) {
					// skip on the first time - try to encode everything first
					if (i !== len) delete sanitized[this.#names[i]!];

					const state = Codec.encode(
						JSON.stringify({
							issues: result.issues,
							id: this.#id,
							values: sanitized,
						} satisfies Schema.Form.State),
					);

					if (state.byteLength <= FormSchema.#maxStateBytes) {
						search = [FormSchema.#param, Codec.Base64Url.encode(state)];
						break;
					}
				}
			}

			return Object.assign(result, { search });
		}

		return { data } as { data: Schema.Infer<Shape> };
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
	Field = (props: Field.Component.Props<Shape>) =>
		this.#fields[props.name]!.Field({
			...props,
			state: this.#decode(props.state),
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
	Fields = (
		props: // partial because name is not required
		Partial<Field.Component.Props<Shape>> = {},
	) => {
		const state = this.#decode(props.state); // pulled out to not call each map iteration

		return this.#names.map((name) =>
			this.#fields[name]!.Field({ ...props, name, state }),
		);
	};

	/**
	 * Access bound sub-components for a field.
	 *
	 * @template N Type of the form field name
	 * @param name Field name
	 * @example
	 *
	 * ```tsx
	 * const Radio = User.field("radio");
	 *
	 * <Radio.Label />
	 * <Radio.Control />
	 * ```
	 */
	field = <N extends Shape.Name<Shape>>(
		props: { name: N } & Field.Component.Props<Shape>,
	): Field.Component<Shape[N]> =>
		this.#fields[props.name]!.Component({
			...props,
			state: this.#decode(props.state),
		});
}

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
		readonly props?: Props;
	}

	/**
	 * @param data Form data
	 * @param name HTML name attribute
	 * @returns Resolved value read from the form data
	 */
	export type Read = (data: FormData, name: string) => unknown;

	/** Form field tag name */
	export type Tag = "input" | "textarea" | "select";

	/** `<input type=...>` */
	export type Type = JSX.IntrinsicElements["input"]["type"];

	/** Value type for select and radio options */
	export type Values = readonly [string, ...string[]];

	/** Any field - `<input type=...>` / `<select>` / `<textarea>` */
	export type Any = Field<unknown, Tag, Type, Values | undefined>;

	/**
	 * Obtain the tag name of a field.
	 *
	 * @template F Field
	 */
	export type TagOf<F extends Any> =
		F extends Field<unknown, infer T, Field.Type, Field.Values | undefined>
			? T
			: Tag;

	export namespace Component {
		/**
		 * Component props available to users to pass into the
		 * constructed `<Field />` component.
		 *
		 * @template S Form shape type
		 * @template I `true` the state is a `State.Input`, `false` is just `State`
		 */
		export type Props<S extends Schema.Form.Shape, I extends boolean = true> = {
			/** Field name attribute */
			readonly name: Shape.Name<S>;

			/** Form state */
			readonly state?: I extends true
				? Schema.Form.State.Input<S>
				: Schema.Form.State<S>;
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
		} & (F extends Field<unknown, "select", Field.Type, infer V>
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
			: F extends Field<unknown, "input", Field.Type, infer V>
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

/**
 * Represents a form field with parsing logic and rendering metadata.
 *
 * @template Output Output type of the field
 * @template Tag Tag name
 * @template Type Input type
 * @template Values Persisted field value type
 */
export class Field<
	Output = unknown,
	Tag extends Field.Tag = "input",
	Type extends Field.Type = Field.Type,
	Values extends Field.Values | undefined = undefined,
> extends Schema<Output> {
	/** Read the value from form data */
	readonly read: Field.Read;

	/** Field type */
	readonly type: Type;

	/** Field options */
	readonly #options: Field.Options<Values, Tag>;

	/** Field tag */
	readonly #tag: Tag;

	/** Field values */
	readonly #values: Values;

	/**
	 * Create a new field.
	 *
	 * @param options Field  options
	 * @param parse How to validate the input
	 * @param read How to read the data from `FormData`
	 */
	constructor(
		options: Field.Options<Values, Tag>,
		parse: Schema<Output> | Schema.Parse.Constructor<Output>,
		read?: Field.Read,
	) {
		super(parse instanceof Schema ? parse.parse : parse);

		this.#options = options;
		this.#tag = (options.tag ?? "input") as Tag;
		this.#values = options.values as Values;

		this.read =
			read ??
			// default to FormData.get
			((data, name) => {
				const v = data.get(name);
				return v == null ? undefined : v;
			});

		this.type = options.props?.type as Type;
	}

	/**
	 * Derive a new Field from the current instance type.
	 *
	 * @template O Output type of the new Field
	 * @param parse Parse function that validates and transforms input
	 * @returns New `Field` instance
	 */
	override derive<O>(parse: Schema.Parse.Constructor<O>) {
		return new Field<O, Tag, Type, Values>(this.#options, parse, this.read);
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Field component with sub-components
	 */
	Component<const S extends Schema.Form.Shape>(
		props: Field.Component.Props<S, false>,
	): Field.Component<this>;
	Component<const S extends Schema.Form.Shape>({
		state,
		...props
	}: Field.Component.Props<S, false>): unknown {
		const value = state?.values?.[props.name];
		const issue = state?.issues?.find((i) => i.path[0] === props.name);
		const issueId = issue && `${props.name}-issue`;

		const control = {
			id: props.name,
			autocomplete: "on",
			autofocus: issue?.path[0] === props.name, // first issue
			"aria-invalid": issue && "true",
			"aria-describedby": issueId,
			...this.#options.props,
			...props,
		};

		const Issue = (data: Field.Component.Issue = {}) =>
			issue && // render nothing if no issue
			jsx("p", {
				id: issueId,
				children: issue.message,
				"data-issue": issue && state!.issues!.indexOf(issue), // issue index starting from 0
				...data,
			});

		if (this.#values && this.#tag !== "select") {
			// radio/checkboxes
			// make multiple ids for the group so all don't have the same id
			const groupId = (value: string) =>
				`${control.name}-${value}`.toLowerCase();

			const Control = (
				data: Field.Component.Control.Group<"input", Field.Values>,
			) =>
				jsx(this.#tag, {
					...control,
					id: groupId(data.value),
					// autofocus only the first input in the group
					autofocus: control.autofocus && data.value === this.#values?.[0],
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
					jsx("legend", { children: control.name, ...data }),
				...this,
			};
		}

		return {
			Issue,
			Root: (data: Field.Component.Root = {}) => jsx("div", data),
			Label: (data: Field.Component.Label = {}) =>
				jsx("label", { for: control.id, children: control.name, ...data }),
			Control: (data?: Field.Component.Control<Tag>) => {
				const attrs = { ...control, ...data };

				if (value !== undefined) {
					if (this.#tag === "textarea") {
						attrs.children = value;
					} else if (this.#tag === "input") {
						if (this.type === "checkbox") {
							attrs.checked = value;
						} else {
							attrs.value = value;
						}
					}
				}

				return jsx(this.#tag, attrs);
			},
			Option:
				// select
				this.#values &&
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
	#Group<const S extends Schema.Form.Shape>(
		this: Field<Output, "input", "radio" | "checkbox", Field.Values>,
		props: Field.Component.Props<S, false>,
	) {
		const Base = this.Component(props);

		return Base.Root({
			children: [
				jsx("legend", { children: props.name }),
				this.#values.map((value: string) => {
					return jsx("div", {
						children: [Base.Control({ value }), Base.Label({ value })],
					});
				}),
				Base.Issue(),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Select component
	 */
	#Select<const S extends Schema.Form.Shape>(
		this: Field<Output, "select", Type, Field.Values>,
		props: Field.Component.Props<S, false>,
	) {
		const Base = this.Component(props);

		return Base.Root({
			children: [
				Base.Label(),
				Base.Control({
					children: this.#values.map((value: string) => Base.Option({ value })),
				}),
				Base.Issue(),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Default input component
	 */
	#Input<const S extends Schema.Form.Shape>(
		props: Field.Component.Props<S, false>,
	) {
		const Base = this.Component(props);

		return Base.Root({
			children: [Base.Label(), Base.Control(), Base.Issue()],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props including `name` of the field to render
	 * @returns Component that renders the HTML field with default structure
	 */
	Field<const S extends Schema.Form.Shape>(
		props: Field.Component.Props<S, false>,
	) {
		if (this.#values) {
			if (this.#tag === "select") return this.#Select(props);

			return this.#Group(props);
		}

		return this.#Input(props);
	}
}
