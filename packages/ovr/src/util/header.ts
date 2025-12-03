// shared content type header to minify better
export const contentType = "content-type";

/**
 * @param header header value to parse
 * @returns Map containing each key=value pair
 */
export const parse = (header: string | null) => {
	const parsed: Record<string, string> = {};

	if (header) {
		const headerLength = header.length;

		for (let cursor = 0; cursor < headerLength; ) {
			const equal = header.indexOf("=", cursor);
			if (equal === -1) break; // done

			let semi = header.indexOf(";", cursor);
			if (semi === -1) semi = headerLength;

			if (equal > semi) {
				// equal is in the next pair, current is malformed
				// move the cursor to the start of the next and ignore
				cursor = header.lastIndexOf(";", equal - 1) + 1;
				continue;
			}

			const key = header.slice(cursor, equal).trim();

			if (!(key in parsed)) {
				// first value should take precedence

				let value = header.slice(equal + 1, semi).trim();

				if (value[0] === '"' && value[value.length - 1] === '"') {
					// remove quotes
					value = value.slice(1, -1);
				}

				if (value.includes("%")) {
					// most values don't need to be decoded
					try {
						// cookies must be a simple string
						value = decodeURIComponent(value);
					} catch {
						// ignore
					}
				}

				parsed[key] = value;
			}

			cursor = semi + 1;
		}
	}

	return parsed;
};
