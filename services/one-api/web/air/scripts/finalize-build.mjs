import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const airDir = path.resolve(scriptDir, '..');
const buildDir = path.join(airDir, 'build');
const targetDir = path.resolve(airDir, '..', 'build', 'air');

await fs.rm(targetDir, { recursive: true, force: true });
await fs.mkdir(path.dirname(targetDir), { recursive: true });
await fs.rename(buildDir, targetDir);

console.log(`Frontend build moved to ${targetDir}`);
