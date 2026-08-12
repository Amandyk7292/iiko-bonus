import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const attempts = Number(argv[argv.indexOf('--attempts') + 1] || 3);
const initialDelaySeconds = Number(argv[argv.indexOf('--initial-delay-seconds') + 1] || 5);
const command = separator >= 0 ? argv.slice(separator + 1) : [];

if (
  !Number.isSafeInteger(attempts) ||
  attempts < 1 ||
  attempts > 5 ||
  !Number.isSafeInteger(initialDelaySeconds) ||
  initialDelaySeconds < 1 ||
  initialDelaySeconds > 60 ||
  command.length === 0
) {
  console.error(
    'Usage: node scripts/run-with-backoff.mjs --attempts 3 --initial-delay-seconds 10 -- <command> [args...]',
  );
  process.exit(2);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const run = () =>
  new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

let exitCode = 1;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  exitCode = await run();
  if (exitCode === 0) process.exit(0);
  if (attempt === attempts) break;
  const waitSeconds = initialDelaySeconds * 2 ** (attempt - 1);
  console.warn(
    `Command failed with exit code ${exitCode}; retrying in ${waitSeconds}s (${attempt + 1}/${attempts}).`,
  );
  await delay(waitSeconds * 1000);
}

process.exit(exitCode);
