import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads the compiled engine.
 *
 * The path is resolved against the working directory rather than
 * `import.meta.url`, because the tests run in a jsdom environment where that
 * URL is an `http:` one and cannot be turned back into a file path.
 */
export function readWasm(): Buffer {
  const candidates = [
    'src/wasm/cellmoa_wasm.wasm',
    'packages/grid/src/wasm/cellmoa_wasm.wasm',
    '../../target/wasm32-unknown-unknown/release/cellmoa_wasm.wasm',
  ];
  for (const candidate of candidates) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      return readFileSync(path);
    }
  }
  throw new Error(
    'the engine has not been built; run `npm run build:wasm` in packages/grid',
  );
}
