import { Fragment, type JSX, jsx } from "../jsx/index.js";
import { Multipart } from "../multipart/index.js";
import { Checksum, Codec, Size } from "../util/index.js";
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
		 * @template V Extra valid result metadata
		 */
		export type Result<O, M extends object = {}, V extends object = {}> =
			| (Valid<O> & V)
			| (Invalid & M);

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
				: S extends any[]
					? // array - better zod compat
						Infer<S[number]>[]
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
	static omit<S extends Record<string, unknown>, N extends ShapeUtil.Name<S>>(
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
 * Minimal schema validator geared around parsing form data like
 * multipart `FormData` and `URLSearchParams`.
 *
 * Implements Standard Schema v1 via the `~standard` property (sync validate).
 *
 * @template Output Output type after parsing
 */
export class Schema<Output> implements StandardSchemaV1<unknown, Output> {
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

		/** User submitted / sanitized values */
		readonly values?: Form.Value.Map;

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

	readonly "~standard": StandardSchemaV1.Props<unknown, Output> = {
		version: 1,
		vendor: "ovr",
		validate: (value) => {
			const result = this.parse(value);

			return result.issues ? result : { value: result.data };
		},
	};

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
		return new Schema<O>(parse);
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
	>(
		this: Field.Instance<Output, T, U, V>,
	): Field.Instance<Output | null, T, U, V>;
	/**
	 * @returns Nullable schema
	 */
	nullable(this: Schema<Output>): Schema<Output | null>;
	nullable(this: Schema<Output>) {
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
	>(
		this: Field.Instance<Output, T, U, V>,
	): Field.Instance<Output | null | undefined, T, U, V>;
	/**
	 * @returns Nullish schema
	 */
	nullish(this: Schema<Output>): Schema<Output | null | undefined>;
	nullish(this: Schema<Output>) {
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
		return this.derive((v, path) => {
			if (v === undefined) return { data: value };

			return this.parse(v, path);
		});
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
		return this.derive((v, path) => this.parse(fn(v), path));
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
		return this.derive((v, path) => {
			const result = this.parse(v, path);

			return result.issues ? result : next.parse(result.data, path);
		});
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
		return this.derive((v, path) => {
			const result = this.parse(v, path);
			if (result.issues) return result;

			let data: unknown;

			try {
				data = JSON.parse(result.data);
			} catch {
				return new Schema.AggregateIssue([
					new Schema.Issue("JSON", path, message),
				]);
			}

			return schema.parse(data, path);
		});
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
		return this.refine((s) => Schema.#emailRegex.test(s), message);
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
		return this.refine(URL.canParse, message);
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
		return this.refine(Number.isSafeInteger, message);
	}

	/**
	 * Validate an input is greater than or equal to the minimum.
	 *
	 * For strings, this validates minimum length.
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
	 * For strings, this validates minimum length.
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
		return this.refine((next) => {
			return typeof next === "string"
				? next.length >= (value as number)
				: next >= (value as number | bigint);
		}, message);
	}

	/**
	 * Validate an input is less than or equal to the maximum.
	 *
	 * For strings, this validates maximum length.
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
	 * For strings, this validates maximum length.
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
		return this.refine((next) => {
			return typeof next === "string"
				? next.length <= (value as number)
				: next <= (value as number | bigint);
		}, message);
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
	static instance<O>(constructor: new (...args: any[]) => O, message?: string) {
		return new Schema((v, path) =>
			v instanceof constructor
				? { data: v }
				: new Schema.AggregateIssue([
						new Schema.Issue(constructor.name, path, message),
					]),
		);
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
		super((value, path) => {
			if (value == null || typeof value !== "object" || Array.isArray(value)) {
				return new Schema.AggregateIssue([new Schema.Issue("Object", path)]);
			}

			const data: Record<string, unknown> = {};
			const issues: Schema.Issue[] = [];

			for (const [name, schema] of Object.entries(shape)) {
				const result = schema.parse((value as Record<string, unknown>)[name], [
					...path,
					name,
				]);

				if (result.issues) {
					issues.push(...result.issues);
				} else {
					data[name] = result.data;
				}
			}

			if (mode !== "strip") {
				const names = new Set(Object.keys(shape));

				for (const [name, next] of Object.entries(
					value as Record<string, unknown>,
				)) {
					if (!names.has(name)) {
						if (mode === "strict") {
							issues.push(
								new Schema.Issue("never", [...path, name], "Unexpected key"),
							);
						} else {
							data[name] = next;
						}
					}
				}
			}

			return issues.length
				? new Schema.AggregateIssue(issues)
				: ({ data } as { data: Schema.Object.Output<Shape, Mode> });
		});

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
	pick<N extends ShapeUtil.Name<Shape>>(names: readonly [N, ...N[]]) {
		return new ObjectSchema(ShapeUtil.pick(this.shape, names), this.#mode);
	}

	/**
	 * Remove selected field names.
	 *
	 * @template N Removed key names
	 * @param names Non-empty list of key names to remove
	 * @returns New object schema without selected keys
	 */
	omit<N extends ShapeUtil.Name<Shape>>(names: readonly [N, ...N[]]) {
		return new ObjectSchema(ShapeUtil.omit(this.shape, names), this.#mode);
	}

	/**
	 * Reject unknown keys during parsing.
	 *
	 * @returns New object schema in strict mode
	 */
	strict() {
		return new ObjectSchema(this.shape, "strict");
	}

	/**
	 * Preserve unknown keys during parsing.
	 *
	 * @returns New object schema in loose mode
	 */
	loose() {
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
			{
				/** Encoded URL search param field state */
				readonly search: Result.Search;

				/** Invalid parses do not expose remaining multipart parts */
				readonly parts?: never;
			} & M,
			{
				/** Rest of the multipart parts to stream */
				readonly parts?: AsyncGenerator<Multipart.Part>;
			}
		>;

		export namespace Result {
			/** Form search param key/value */
			export type Search = ["_form", string] | undefined;
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
	/** Form state param key. */
	static readonly #param = "_form";

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
	 * Sanitizes persisted values by removing unsupported or oversized entries.
	 *
	 * @param values Candidate values to persist
	 * @returns Sanitized values
	 */
	#sanitize(values?: Record<string, unknown>) {
		const sanitized: Form.Value.Map<Shape> = {};

		if (values) {
			for (const [name, value] of Object.entries(values)) {
				const field = this.shape[name];

				if (field && Form.#persist(field) && value != null) {
					const result = Form.#valueSchema.parse(value);

					if (
						!result.issues &&
						JSON.stringify(result.data).length <= Form.#maxValueChars
					) {
						sanitized[name as ShapeUtil.Name<Shape>] = result.data;
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
	#decode(stateInput?: Form.State.Input<Shape>): Form.State<Shape> | undefined {
		if (stateInput) {
			let state: Form.State<Shape> | undefined;

			if (typeof stateInput === "object" && "id" in stateInput) {
				state = stateInput;
			} else {
				const encoded =
					typeof stateInput === "string"
						? stateInput
						: stateInput instanceof URL
							? stateInput.searchParams.get(Form.#param)
							: stateInput.get(Form.#param);

				if (encoded && encoded.length <= Form.#maxStateBytes * 2) {
					const valuesShape: Schema.Object.Shape = {};

					for (const name of Object.keys(this.shape)) {
						valuesShape[name] = Form.#valueSchema.optional();
					}

					try {
						const result = Schema.string()
							.json(
								Schema.object({
									id: Schema.literal(this.#id),
									issues: Schema.array(Schema.object().loose()).optional(),
									values: Schema.object(valuesShape).optional(),
								}),
							)
							.parse(Codec.decode(Codec.Base64Url.decode(encoded)));

						if (result.data) state = result.data as Form.State<Shape>;
					} catch {}
				}
			}

			if (state?.id === this.#id) {
				return { ...state, values: this.#sanitize(state.values) };
			}
		}
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
		let parts: AsyncGenerator<Multipart.Part> | undefined;

		if (source instanceof Multipart) {
			form = new FormData();
			const iter = source[Symbol.asyncIterator]();

			let current: IteratorResult<Multipart.Part>;

			while ((current = await iter.next()) && !current.done) {
				const part = current.value;

				if (part.name) {
					const field = this.shape[part.name];

					if (!field) {
						issues.push(this.#unexpected(part.name, path));
					} else if (field.streaming) {
						// expose current and rest of the parts to the user
						parts = (async function* () {
							try {
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
		} else if (source instanceof FormData) {
			form = source;

			for (const name of new Set(source.keys())) {
				if (!this.shape[name]) issues.push(this.#unexpected(name, path));
			}
		} else {
			// allow passthrough for URLSearchParams
			form = source;
		}

		for (const [name, field] of Object.entries(this.shape)) {
			if (!field.streaming) {
				const value = field.read(form, name);
				const result = field.parse(value, [...path, name]);

				if (result.issues) {
					issues.push(...result.issues);
				} else {
					data[name] = result.data;
				}

				if (Form.#persist(field) && value != null) values[name] = value;
			}
		}

		if (issues.length) {
			const result = new Schema.AggregateIssue(issues, this.#sanitize(values));
			let search: Form.Parse.Result.Search;

			if (result.values) {
				// encode into search
				const len = this.names.length;

				for (let i = len; i >= 0; i--) {
					// skip on the first time - try to encode everything first
					if (i !== len) delete result.values[this.names[i]!];

					const state = Codec.encode(
						JSON.stringify({
							issues: result.issues,
							values: result.values,
							id: this.#id,
						} satisfies Form.State),
					);

					if (state.byteLength <= Form.#maxStateBytes) {
						search = [Form.#param, Codec.Base64Url.encode(state)];
						break;
					}
				}
			}

			if (parts) {
				// invalid result does not expose streamed parts, drain the remainder
				// so adapters that require body consumption can respond
				try {
					for await (const _ of parts);
				} catch {}
			}

			return Object.assign(result, { search });
		}

		return { data: data as Form.Parse.Data<Shape>, parts };
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
		this.shape[props.name]!.render({
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
	component = <N extends ShapeUtil.Name<Shape>>(
		props: { name: N } & Field.Component.Props<Shape>,
	): Field.Component<Shape[N]> =>
		this.shape[props.name]!.component({
			...props,
			state: this.#decode(props.state),
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
	readonly read: Field.Read;

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
	readonly streaming?: Stream;

	/** Field options */
	readonly #options: Field.Options<Values, Tag>;

	/**
	 * Create a new field.
	 *
	 * @param options Field options
	 * @param parse How to validate the input
	 * @param read How to read the form data
	 * @param parts Maximum expected multipart parts for this field
	 * @param stream If this field should be streamed as a multipart part
	 */
	constructor(
		options: Field.Options<Values, Tag>,
		parse: Schema<Output> | Schema.Parse.Constructor<Output>,
		read?: Field.Read,
		parts = 1,
		stream?: Stream,
	) {
		super(parse instanceof Schema ? parse.parse : parse);

		this.#options = options;
		this.tag = (options.tag ?? "input") as Tag;
		this.values = options.values as Values;

		this.read =
			read ??
			// default to .get()
			((data, name) => {
				const v = data.get(name);
				return v == null ? undefined : v;
			});

		this.type = options.props?.type as Type;
		this.parts = parts;
		this.streaming = stream;
	}

	/**
	 * Stream this field as a multipart request `Part`.
	 *
	 * @returns Part field
	 */
	stream(): Field.Instance<Output, Tag, Type, Values, true> {
		return new FieldSchema<Output, Tag, Type, Values, true>(
			this.#options,
			this.parse,
			this.read,
			this.parts,
			true,
		);
	}

	/**
	 * Derive a new Field from the current instance type.
	 *
	 * @template O Output type of the new Field
	 * @param parse Parse function that validates and transforms input
	 * @returns New `Field` instance
	 */
	override derive<O>(
		parse: Schema.Parse.Constructor<O>,
	): Field.Instance<O, Tag, Type, Values, Stream> {
		return new FieldSchema<O, Tag, Type, Values, Stream>(
			this.#options,
			parse,
			this.read,
			this.parts,
			this.streaming,
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
		const control: Field.Props = {
			id: props.name,
			autocomplete: "on",
			autofocus: issue?.path[0] === props.name, // first issue
			"aria-invalid": issue && "true",
			"aria-describedby": issueId,
			...this.#options.props,
			...props,
		};
		const hidden = control.type === "hidden";

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
					jsx("legend", { children: control.name, ...data }),
				...this,
			};
		}

		return {
			Issue,
			Root: (data: Field.Component.Root = {}) =>
				hidden ? Fragment(data) : jsx("div", data),
			Label: (data: Field.Component.Label = {}) =>
				!hidden &&
				jsx("label", { for: control.id, children: control.name, ...data }),
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
				jsx("legend", { children: props.name }),
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
	 * @param data FormData or URLSearchParams
	 * @param name HTML name attribute
	 * @returns Resolved value read from the form data
	 */
	export type Read = (
		data: FormData | URLSearchParams,
		name: string,
	) => unknown;

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
		 * @template I `true` the state is a `State.Input`, `false` is just `State`
		 */
		export type Props<S extends Form.Shape, I extends boolean = true> = {
			/** Field name attribute */
			readonly name: ShapeUtil.Name<S>;

			/** Form state */
			readonly state?: I extends true ? Form.State.Input<S> : Form.State<S>;
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
	/**
	 * @param props Input props
	 * @returns Generic input field
	 */
	static #input<T extends Field.Type>(
		props: Field.Props.Input & { type: T },
	): Field.Instance<string, "input", T> {
		return new FieldSchema({ props }, Schema.string().preprocess(String));
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
			Schema.string().email(message),
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
			Schema.string().url(message),
		);
	}

	/**
	 * @param props Input props
	 * @returns Input field
	 */
	static #number<T extends "number" | "range">(
		props: Field.Props.Input & { type: T },
	): Field.Instance<number, "input", T> {
		return new FieldSchema({ props }, Schema.number().preprocess(Number));
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
	 * @param message Issue message when invalid
	 * @returns File input field
	 */
	static file(
		props?: Field.Props.Input,
		message?: string,
	): Field.Instance<File, "input", "file"> {
		return new FieldSchema(
			{ props: { ...props, type: "file" } },
			Schema.instance(File, message),
		);
	}

	/**
	 * @param props Input props
	 * @param message Issue message when invalid
	 * @returns Multiple file input field
	 */
	static files(
		props?: Field.Props.Input,
		message?: string,
	): Field.Instance<File[], "input", "file"> {
		return new FieldSchema(
			{ props: { ...props, type: "file", multiple: true } },
			Schema.array(Schema.instance(File, message)),
			(formData, name) => formData.getAll(name),
			Infinity,
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
	): Field.Instance<V[], "input", "checkbox", readonly [V, ...V[]]> {
		return new FieldSchema(
			{ values, props: { ...props, type: "checkbox" } },
			Schema.array(Schema.enum(values, message)),
			(formData, name) => formData.getAll(name),
			values.length,
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
	): Field.Instance<V, "input", "radio", readonly [V, ...V[]]> {
		return new FieldSchema(
			{ values, props: { ...props, type: "radio" } },
			Schema.enum(values, message),
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
			Schema.string().preprocess(String),
		);
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
	): Field.Instance<V, "select", Field.Type, readonly [V, ...V[]]> {
		return new FieldSchema(
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
	): Field.Instance<V[], "select", Field.Type, readonly [V, ...V[]]> {
		return new FieldSchema(
			{ tag: "select", values, props: { ...props, multiple: true } },
			Schema.array(Schema.enum(values, message)),
			(formData, name) => formData.getAll(name),
			values.length,
		);
	}
}
