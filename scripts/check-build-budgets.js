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
  const deferredPriceLabelPdf = javascript.filter((file) =>
    path.basename(file).startsWith('price-label-pdf-'),
  );
  const deferredPriceLabelCorel = javascript.filter((file) =>
    path.basename(file).startsWith('price-label-corel-'),
  );
  const coreJavascript = javascript.filter(
    (file) => !deferredPriceLabelPdf.includes(file) && !deferredPriceLabelCorel.includes(file),
  );
  const styles = assets.filter((file) => file.endsWith('.css'));
  const javascriptGzip = coreJavascript.map(gzipSize);
  const priceLabelPdfGzip = deferredPriceLabelPdf.map(gzipSize);
  const priceLabelCorelGzip = deferredPriceLabelCorel.map(gzipSize);
  const styleGzip = styles.map(gzipSize);
  assertBudget(
    'Admin total JavaScript gzip',
    javascriptGzip.reduce((sum, size) => sum + size, 0),
    // Approved tablets and retained report audits add 3,172 B to e021cc3e:
    // 446,493 B total. They stay in the deferred PhotoReportsPage chunk.
    // Allow 1,507 B headroom;
    // retain the largest-chunk/CSS limits.
    // Exporters load only on download and keep their separate budgets below.
    448_000,
  );
  assertBudget('Admin largest JavaScript gzip', Math.max(0, ...javascriptGzip), 82_000);
  assertBudget('Admin deferred price-label PDF gzip', Math.max(0, ...priceLabelPdfGzip), 185_000);
  assertBudget('Admin deferred price-label Corel gzip', Math.max(0, ...priceLabelCorelGzip), 2_000);
  // Shared workspace styling measures 32,045 B at f031c12 (about 2% margin).
  assertBudget('Admin largest CSS gzip', Math.max(0, ...styleGzip), 33_000);
}

const flutterDirectory = option('--flutter');
if (flutterDirectory) {
  const directory = path.resolve(flutterDirectory);
  const mainFile = path.join(directory, 'main.dart.js');
  if (!fs.existsSync(mainFile)) {
    failures.push(`Flutter entry is missing: ${mainFile}`);
  } else {
    // The optional cashier signup/QR flow measures 6,677,016 B raw and
    // 1,822,147 B gzip after finalization. Keep 2,984 B / 1,853 B headroom. Its QR decoder is
    // deferred until scanning and has a separate total budget below.
    assertBudget('Flutter main.dart.js', fs.statSync(mainFile).size, 6_680_000);
    assertBudget('Flutter main.dart.js gzip', gzipSize(mainFile), 1_824_000);
  }
  const deferredChunks = filesUnder(directory).filter((file) => /\.part\.js$/.test(file));
  // One locally decoded QR chunk measures 56,453 B raw / 19,842 B gzip.
  assertBudget('Flutter deferred JavaScript total',
    deferredChunks.reduce((sum, file) => sum + fs.statSync(file).size, 0), 58_000);
  assertBudget('Flutter deferred JavaScript total gzip',
    deferredChunks.reduce((sum, file) => sum + gzipSize(file), 0), 21_000);
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
