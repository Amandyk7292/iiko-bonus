const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const failures = [];

const filesUnder = (directory) => {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else files.push(target);
    }
  };
  visit(directory);
  return files;
};

const gzipSize = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const assertBudget = (label, actual, maximum) => {
  if (actual > maximum) failures.push(`${label}: ${formatKb(actual)} > ${formatKb(maximum)}`);
};

const adminDirectory = option('--admin');
if (adminDirectory) {
  const directory = path.resolve(adminDirectory);
  const assets = filesUnder(path.join(directory, 'assets'));
  const javascript = assets.filter((file) => file.endsWith('.js'));
  const styles = assets.filter((file) => file.endsWith('.css'));
  const javascriptGzip = javascript.map(gzipSize);
  const styleGzip = styles.map(gzipSize);
  assertBudget(
    'Admin total JavaScript gzip',
    javascriptGzip.reduce((sum, size) => sum + size, 0),
    // Cashier access, the iPad staff workflow, the lazy-loaded Taplink
    // constructor, and explicit accessible states account for the latest
    // growth. Keep a small cross-platform build margin without hiding
    // meaningful regressions.
    330_000,
  );
  assertBudget('Admin largest JavaScript gzip', Math.max(0, ...javascriptGzip), 82_000);
  // Focus rings, 48px staff controls, and contrast-safe states are intentional.
  assertBudget('Admin largest CSS gzip', Math.max(0, ...styleGzip), 31_000);
}

const flutterDirectory = option('--flutter');
if (flutterDirectory) {
  const directory = path.resolve(flutterDirectory);
  const mainFile = path.join(directory, 'main.dart.js');
  if (!fs.existsSync(mainFile)) {
    failures.push(`Flutter entry is missing: ${mainFile}`);
  } else {
    assertBudget('Flutter main.dart.js', fs.statSync(mainFile).size, 4_800_000);
    assertBudget('Flutter main.dart.js gzip', gzipSize(mainFile), 1_350_000);
  }
  const wasmFiles = filesUnder(directory).filter((file) => file.endsWith('.wasm'));
  assertBudget(
    'Flutter largest WebAssembly asset',
    Math.max(0, ...wasmFiles.map((file) => fs.statSync(file).size)),
    7_300_000,
  );
}

if (!adminDirectory && !flutterDirectory) {
  failures.push('Use --admin <dist> or --flutter <build/web>.');
}

if (failures.length) {
  console.error(`Build budgets exceeded:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Build budgets passed.');
}
