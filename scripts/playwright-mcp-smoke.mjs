import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const urls = [
  { name: 'webflow-made-in-webflow', url: 'https://webflow.com/made-in-webflow' },
  { name: '21st-dev-magic', url: 'https://21st.dev/magic' },
  { name: 'nextjs-docs', url: 'https://nextjs.org/docs' },
  { name: 'supabase-docs', url: 'https://supabase.com/docs' },
];

const outDir = path.resolve(process.cwd(), 'smoke-artifacts', 'playwright-mcp');
fs.mkdirSync(outDir, { recursive: true });

const isWindows = process.platform === 'win32';
const failures = [];

for (const target of urls) {
  const filePath = path.join(outDir, `${target.name}.png`);
  const playArgs = ['playwright', 'screenshot', '--timeout=45000', target.url, filePath];
  const command = isWindows ? 'cmd.exe' : 'npx';
  const args = isWindows ? ['/c', 'npx.cmd', ...playArgs] : playArgs;

  process.stdout.write(`\n[smoke] capturing ${target.url}\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (result.error) {
    process.stderr.write(`[smoke] execution error for ${target.url}: ${String(result.error)}\n`);
  }

  if (result.status !== 0 || !fs.existsSync(filePath)) {
    process.stderr.write(`[smoke] capture failed for ${target.url} (status=${String(result.status)})\n`);
    failures.push(target.url);
  } else {
    process.stdout.write(`[smoke] ok -> ${filePath}\n`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n[smoke] failed targets:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}

process.stdout.write(`\n[smoke] success. artifacts at ${outDir}\n`);
