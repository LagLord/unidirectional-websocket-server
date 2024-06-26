import type { ZlibOptions } from "node:zlib";

export const CHANGE_STREAM_LOOP_MS = 3000;
export const PAYLOAD_SIZE_BYTES = 2 * 1000_000 // 2 mb for now
export const BACKLOG_CONNECTIONS = 100;
export const CHAT_COLLECTION = "chat_server";
export const RATE_LIMIT_HALF_MIN = 10;
export const MESSAGE_BUFFER_LEN = 50;
export const GLOBAL_SERVER_NAME = '__global__';

export const COMPRESSION_OPTIONS: ZlibOptions = {
    level: 9, // Maximum compression(1-9)
    memLevel: 6, // High memory usage for better compression (1-9)
};
export const COMPRESSION_MIN_USER_THRESHOLD = 0 // 10;