import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const fallbackBaseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5173';
const outDir = path.resolve(process.cwd(), 'smoke-artifacts', 'playwright-e2e');
const appShot = path.join(outDir, 'app-home.png');

async function waitForHttp(getUrl, timeoutMs = 120000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const url = getUrl();

    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return;
      }
    } catch {
      // keep waiting for startup
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
      }
    });
  });
}

async function runWithTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}

async function checkJsonEndpoint(url, name) {
  const res = await fetch(url);
  const text = await res.text();
  const file = path.join(outDir, `${name}.txt`);
  await writeFile(file, `status=${res.status}\n${text.slice(0, 2000)}\n`, 'utf8');
  return { status: res.status, file };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let activeBaseUrl = fallbackBaseUrl;

  const devProcess = spawn('npm.cmd', ['run', 'dev'], {
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, PORT: '5173' },
  });

  let devOutput = '';
  const append = (chunk) => {
    devOutput += chunk.toString();
    if (devOutput.length > 20000) {
      devOutput = devOutput.slice(-20000);
    }

    const urlMatch = devOutput.match(/http:\/\/localhost:\d+\//);
    if (urlMatch?.[0]) {
      activeBaseUrl = urlMatch[0].replace(/\/$/, '');
    }
  };

  devProcess.stdout.on('data', append);
  devProcess.stderr.on('data', append);

  try {
    console.log('[e2e-smoke] waiting for dev server url');
    await waitForHttp(() => activeBaseUrl, 180000);
    console.log(`[e2e-smoke] using ${activeBaseUrl}`);

    console.log('[e2e-smoke] capturing app home screenshot');
    await runWithTimeout(
      run('npx.cmd', ['playwright', 'screenshot', '--timeout=45000', activeBaseUrl, appShot]),
      90000,
      'playwright screenshot',
    );

    console.log('[e2e-smoke] checking api/health');
    const health = await checkJsonEndpoint(`${activeBaseUrl}/api/health`, 'api-health');

    console.log('[e2e-smoke] checking api/models');
    const models = await checkJsonEndpoint(`${activeBaseUrl}/api/models`, 'api-models');

    if (health.status >= 500 || models.status >= 500) {
      throw new Error(
        `Endpoint health check failed: /api/health=${health.status}, /api/models=${models.status}`,
      );
    }

    console.log('[e2e-smoke] success');
    console.log(`[e2e-smoke] artifact: ${appShot}`);
    console.log(`[e2e-smoke] artifact: ${health.file}`);
    console.log(`[e2e-smoke] artifact: ${models.file}`);
  } finally {
    devProcess.kill();
    if (devOutput.trim().length) {
      await writeFile(path.join(outDir, 'dev-log-tail.txt'), devOutput, 'utf8');
    }
  }
}

main().catch((error) => {
  console.error('[e2e-smoke] failed:', error);
  process.exitCode = 1;
});
