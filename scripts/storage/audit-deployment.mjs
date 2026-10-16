import { readdir, stat } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
const root = resolve(process.argv[2] ?? 'dist');
const files = [];
async function inventory(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) await inventory(path);
    else if (item.isFile()) files.push({ path: relative(root, path), bytes: (await stat(path)).size });
  }
}
await inventory(root);
const originals = files.filter(file => ['.pdf', '.hwpx'].includes(extname(file.path).toLowerCase()));
const cipher = files.filter(file => file.path.includes('__manual_cipher'));
console.log(JSON.stringify({ root, total_bytes: files.reduce((sum, file) => sum + file.bytes, 0), original_manual_files: originals,
  required_parsed_corpus_cipher_bytes: cipher.reduce((sum, file) => sum + file.bytes, 0), largest_files: files.toSorted((a, b) => b.bytes - a.bytes).slice(0, 10) }, null, 2));
process.exitCode = originals.length ? 1 : 0;
