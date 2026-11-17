/**
 * Compresses a form's state for a URL. The platform's compression streams
 * are asynchronous, and a form's state is written and read as a page
 * renders, so this is LZW: small, and without anything to wait for. Text
 * such as a recipe's is about half the length it is as Base64.
 */

/** The characters of the output, six bits each, all safe in a URL */
const alphabet =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Each character's six bits, `undefined` for one not in the alphabet */
const values = new Map(Array.from(alphabet, (char, value) => [char, value]));

/** The most codes a table holds, so a code is at most 16 bits */
const most = 1 << 16;

/** A code's width before the table needs more: one more than a byte's */
const least = 9;

/**
 * @param value Code
 * @returns The bits it takes to write
 */
const bits = (value: number) => 32 - Math.clz32(value);

/**
 * @param bytes Bytes to compress
 * @returns The bytes as text that is safe in a URL
 */
export function pack(bytes: Uint8Array) {
	/** A sequence's code, by the code of all but its last byte, and that byte */
	const table = new Map<number, number>();
	let next = 256;
	let text = "";
	let buffer = 0;
	let held = 0;
	/** The code of the sequence read so far */
	let prefix = -1;

	const write = (code: number) => {
		// fewer than 6 bits are held and a code is at most 16, so 32 hold both
		buffer |= code << held;
		held += Math.max(least, bits(next - 1));

		while (held >= 6) {
			text += alphabet[buffer & 63];
			buffer >>>= 6;
			held -= 6;
		}
	};

	for (const byte of bytes) {
		if (prefix < 0) {
			prefix = byte;
			continue;
		}

		const key = (prefix << 8) | byte;
		const code = table.get(key);

		if (code === undefined) {
			write(prefix);
			if (next < most) table.set(key, next++);
			prefix = byte;
		} else prefix = code;
	}

	if (prefix >= 0) write(prefix);
	if (held) text += alphabet[buffer & 63];

	return text;
}

/**
 * @param text Text from `pack`, or anything a URL holds in its place
 * @param limit Most bytes to produce, so a short text cannot ask for more
 * @returns The bytes, `undefined` when the text is not from `pack` or holds
 * more than the limit
 */
export function unpack(text: string, limit: number) {
	/** Each code from 256: the code of all but its last byte, and that byte */
	const prefixes: number[] = [];
	const lasts: number[] = [];
	const bytes: number[] = [];
	let buffer = 0;
	let held = 0;
	let at = 0;
	let previous = -1;

	for (;;) {
		const next = 256 + prefixes.length;
		// a full table keeps the width of its last code
		const width = Math.max(least, bits(Math.min(next, most - 1)));

		while (held < width && at < text.length) {
			const value = values.get(text[at++]!);
			if (value === undefined) return;
			buffer |= value << held;
			held += 6;
		}
		// what is left is the padding of the last character
		if (held < width) break;

		const code = buffer & ((1 << width) - 1);
		buffer >>>= width;
		held -= width;

		if (previous < 0) {
			if (code > 255) return;
			bytes.push(code);
			previous = code;
			continue;
		}
		if (code > next) return;

		// the sequence, last byte first, of the code or of the one this
		// defines: the previous sequence and its own first byte
		const start = bytes.length;
		let from = code === next ? previous : code;
		if (code === next) bytes.push(0);
		while (from > 255) {
			bytes.push(lasts[from - 256]!);
			from = prefixes[from - 256]!;
		}
		bytes.push(from);
		if (code === next) bytes[start] = from;
		if (bytes.length > limit) return;

		for (let low = start, high = bytes.length - 1; low < high; low++, high--) {
			const swap = bytes[low]!;
			bytes[low] = bytes[high]!;
			bytes[high] = swap;
		}

		if (next < most) {
			prefixes.push(previous);
			lasts.push(bytes[start]!);
		}
		previous = code;
	}

	return Uint8Array.from(bytes);
}
