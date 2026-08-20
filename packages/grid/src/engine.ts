/**
 * The bridge to the calculation engine.
 *
 * The engine is a WebAssembly module with a handful of exported functions and
 * no generated glue. That keeps this file the only place that knows about
 * linear memory, and it keeps the grid free of a build-time coupling to a
 * particular version of a binding generator.
 */

/** The exports the WebAssembly module provides. */
interface Exports {
  memory: WebAssembly.Memory;
  cellmoa_session_new(): number;
  cellmoa_session_free(session: number): void;
  cellmoa_alloc(len: number): number;
  cellmoa_free(ptr: number, len: number): void;
  cellmoa_dispatch(session: number, ptr: number, len: number): number;
  cellmoa_free_reply(ptr: number): void;
  cellmoa_open_bytes(session: number, ptr: number, len: number): number;
  cellmoa_save_bytes(session: number): number;
  cellmoa_version(): number;
}

/** Anything the module can be loaded from. */
export type WasmSource =
  | BufferSource
  | Response
  | Promise<Response>
  | WebAssembly.Module
  | URL
  | string;

/** A response from the engine. */
export interface EngineResponse {
  ok: boolean;
  revision?: number;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

/** What a failed command carries, so a caller can branch on the reason. */
export class EngineError extends Error {
  readonly code: string;
  readonly detail: EngineResponse;

  constructor(response: EngineResponse) {
    super(response.message ?? 'the engine refused the command');
    this.name = 'EngineError';
    this.code = response.code ?? 'unknown';
    this.detail = response;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * One workbook, held by the engine.
 *
 * Every method is synchronous. The engine recalculates inside a single call,
 * so there is nothing to await — and a grid that had to await every keystroke
 * would be a grid that drops keystrokes.
 */
export class Engine {
  #exports: Exports;
  #session: number;
  #closed = false;

  private constructor(exports: Exports, session: number) {
    this.#exports = exports;
    this.#session = session;
  }

  /** Loads the module and opens an empty workbook. */
  static async load(source: WasmSource): Promise<Engine> {
    const instance = await instantiate(source);
    const exports = instance.exports as unknown as Exports;
    return new Engine(exports, exports.cellmoa_session_new());
  }

  /** The engine's version. */
  get version(): string {
    return this.#takeReply(this.#exports.cellmoa_version());
  }

  /** Sends a command, returning the response whether or not it succeeded. */
  send(request: object): EngineResponse {
    this.#assertOpen();
    const bytes = encoder.encode(JSON.stringify(request));
    const pointer = bytes.length === 0 ? 0 : this.#exports.cellmoa_alloc(bytes.length);
    try {
      if (bytes.length > 0) {
        // The view is taken after the allocation: growing the heap detaches any
        // buffer taken before it, and reading through a detached view is the
        // classic way to get zeroes out of a WebAssembly module.
        new Uint8Array(this.#exports.memory.buffer).set(bytes, pointer);
      }
      const reply = this.#exports.cellmoa_dispatch(this.#session, pointer, bytes.length);
      return JSON.parse(this.#takeReply(reply)) as EngineResponse;
    } finally {
      if (bytes.length > 0) {
        this.#exports.cellmoa_free(pointer, bytes.length);
      }
    }
  }

  /** Sends a command and throws unless it succeeded. */
  call(request: object): EngineResponse {
    const response = this.send(request);
    if (!response.ok) {
      throw new EngineError(response);
    }
    return response;
  }

  /** Loads an `.xlsx` file. */
  open(bytes: Uint8Array): EngineResponse {
    this.#assertOpen();
    const size = Math.max(bytes.length, 1);
    const pointer = this.#exports.cellmoa_alloc(size);
    try {
      new Uint8Array(this.#exports.memory.buffer).set(bytes, pointer);
      const reply = this.#exports.cellmoa_open_bytes(this.#session, pointer, bytes.length);
      return JSON.parse(this.#takeReply(reply)) as EngineResponse;
    } finally {
      this.#exports.cellmoa_free(pointer, size);
    }
  }

  /** Serialises the workbook as an `.xlsx` file. */
  save(): Uint8Array {
    this.#assertOpen();
    const reply = this.#exports.cellmoa_save_bytes(this.#session);
    const view = new DataView(this.#exports.memory.buffer);
    const length = view.getUint32(reply, true);
    // Copied out before the block is released, and before any later call can
    // grow the heap out from under it.
    const bytes = new Uint8Array(this.#exports.memory.buffer, reply + 4, length).slice();
    this.#exports.cellmoa_free_reply(reply);
    return bytes;
  }

  /** Releases the workbook. The engine cannot be used afterwards. */
  close(): void {
    if (!this.#closed) {
      this.#exports.cellmoa_session_free(this.#session);
      this.#closed = true;
    }
  }

  /** Reads a length-prefixed reply and releases it. */
  #takeReply(pointer: number): string {
    const view = new DataView(this.#exports.memory.buffer);
    const length = view.getUint32(pointer, true);
    const bytes = new Uint8Array(this.#exports.memory.buffer, pointer + 4, length);
    const text = decoder.decode(bytes);
    this.#exports.cellmoa_free_reply(pointer);
    return text;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error('this engine has been closed');
    }
  }
}

async function instantiate(source: WasmSource): Promise<WebAssembly.Instance> {
  const imports: WebAssembly.Imports = {};

  if (source instanceof WebAssembly.Module) {
    return WebAssembly.instantiate(source, imports);
  }
  let pending: Response | Promise<Response> | BufferSource;
  if (typeof source === 'string' || source instanceof URL) {
    pending = fetch(source.toString());
  } else {
    pending = source;
  }
  if (pending instanceof Response || pending instanceof Promise) {
    const response = await pending;
    // Streaming compilation needs the server to say `application/wasm`; when it
    // does not, fall back rather than failing on a header.
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        const { instance } = await WebAssembly.instantiateStreaming(response.clone(), imports);
        return instance;
      } catch {
        // fall through to the buffered path
      }
    }
    const buffer = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buffer, imports);
    return instance;
  }
  const { instance } = await WebAssembly.instantiate(pending, imports);
  return instance;
}
