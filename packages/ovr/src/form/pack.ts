import { Codec } from "../util/index.js";

/** How a form's state is compressed for a URL */
const format = "deflate-raw";

/**
 * @param bytes Bytes to compress
 * @returns The bytes compressed, as text that is safe in a URL
 */
export async function pack(bytes: Uint8Array<ArrayBuffer>) {
	return Codec.Base64Url.encode(
		new Uint8Array(
			await new Response(
				new Blob([bytes]).stream().pipeThrough(new CompressionStream(format)),
			).arrayBuffer(),
		),
	);
}

/**
 * @param text Text from `pack`, or anything a URL holds in its place
 * @param limit Most bytes to produce, so a short text cannot ask for more
 * @returns The bytes, `undefined` when the text is not from `pack` or holds
 * more than the limit
 */
export async function unpack(text: string, limit: number) {
	try {
		return await Codec.read(
			new Blob([Codec.Base64Url.decode(text)])
				.stream()
				.pipeThrough(new DecompressionStream(format)),
			limit,
		);
	} catch {
		// not Base64, or not compressed
	}
}
