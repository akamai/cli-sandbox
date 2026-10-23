// Cross-platform replacements for `shx rm -rf` and `shx cp -r`.
import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'clean') {
  for (const dir of args) fs.rmSync(dir, { recursive: true, force: true });
} else if (cmd === 'copy') {
  const dest = args.pop();
  fs.mkdirSync(dest, { recursive: true });
  for (const src of args) {
    fs.cpSync(src, path.join(dest, path.basename(src)), { recursive: true });
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
