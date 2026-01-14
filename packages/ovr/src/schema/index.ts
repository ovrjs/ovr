export namespace S {
	export type Shape = Record<string, S<unknown>>;

	export type Infer<T> =
		T extends S<infer U>
			? U
			: T extends Shape
				? { [K in keyof T]: Infer<T[K]> }
				: never;

	export type Merge<A extends Shape, B extends Shape> = Omit<A, keyof B> & B;
}

/** Error thrown when schema validation fails */
export class SchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SchemaError";
	}
}

/** Internal schema based validator */
export class S<T> {
	static #isNonNullObject(v: unknown): v is Record<string, unknown> {
		return typeof v === "object" && v !== null && !Array.isArray(v);
	}

	/**
	 * Parses and validates value against the schema.
	 * Throws SchemaError if validation fails.
	 *
	 * @param v value to parse
	 * @returns validated value typed as T
	 */
	parse: (v: unknown) => T;

	constructor(parse: (v: unknown) => T) {
		this.parse = parse;
	}

	static string<T extends string | undefined = undefined>(
		literal?: T,
	): S<T extends string ? T : string> {
		return new S((v) => {
			if (typeof v !== "string") throw new SchemaError("Expected string");
			if (literal !== undefined && v !== literal) {
				throw new SchemaError(`Expected "${literal}"`);
			}
			return v as T extends string ? T : string;
		});
	}

	static object<TShape extends S.Shape>(shape: TShape) {
		return new SObject(shape, (v): S.Infer<TShape> => {
			if (!S.#isNonNullObject(v)) throw new SchemaError("Expected object");

			const obj = v as Record<string, unknown>;

			for (const key in shape) {
				if (!Object.hasOwn(obj, key))
					throw new SchemaError(`Missing key: ${key}`);
				shape[key]!.parse(obj[key]);
			}

			return v as S.Infer<TShape>;
		});
	}
}

export class SObject<TShape extends S.Shape> extends S<S.Infer<TShape>> {
	readonly shape: TShape;

	constructor(shape: TShape, parse: (v: unknown) => S.Infer<TShape>) {
		super(parse);
		this.shape = shape;
	}

	extend<TExtra extends S.Shape>(v: TExtra) {
		return S.object({ ...this.shape, ...v } as S.Merge<TShape, TExtra>);
	}
}
