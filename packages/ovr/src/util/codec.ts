/** Codec to use across requests */
export class Codec {
	static readonly #encoder = new TextEncoder();
	static readonly #decoder = new TextDecoder();

	static readonly encode = (s: string) => Codec.#encoder.encode(s);

	/** DO NOT USE FOR STREAMS */
	static readonly decode = (input?: Uint8Array) => Codec.#decoder.decode(input);
}
