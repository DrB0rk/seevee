// Copy the SDK's `.astro` components into `dist/`.
//
// `tsc` only emits JavaScript for `.ts` sources, so `dist/components.js`
// would import `./components/Page.astro` from a file that does not exist.
// The four structural components are Astro components, not TypeScript, so
// the build has to carry them alongside the compiled entry points or every
// template render fails with "Failed to load url ./components/Page.astro".
//
// Templates resolve these at render time through Vite, which needs the real
// `.astro` source rather than compiled output.

import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(packageRoot, 'src', 'components');
const destination = join(packageRoot, 'dist', 'components');

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });

console.log(`copied .astro components -> ${destination}`);