/** @module codec Shared codec to use across requests */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const encode = (s: string) => encoder.encode(s);

/** DO NOT USE FOR STREAMS */
export const decode = (input?: Uint8Array) => decoder.decode(input);
