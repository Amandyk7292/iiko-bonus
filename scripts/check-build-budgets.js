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
  // The employee academy loads only on its own routes. Keep each cabinet/editor
  // bounded separately, retaining the existing operational-interface budget.
  const deferredAcademy = javascript.filter((file) =>
    /^(?:LearningPage|AcademyAdminPage)-/.test(path.basename(file)),
  );
  const coreJavascript = javascript.filter(
    (file) =>
      !deferredPriceLabelPdf.includes(file) &&
      !deferredPriceLabelCorel.includes(file) &&
      !deferredAcademy.includes(file),
  );
  const styles = assets.filter((file) => file.endsWith('.css'));
  const javascriptGzip = coreJavascript.map(gzipSize);
  const priceLabelPdfGzip = deferredPriceLabelPdf.map(gzipSize);
  const priceLabelCorelGzip = deferredPriceLabelCorel.map(gzipSize);
  const styleGzip = styles.map(gzipSize);
  assertBudget(
    'Admin deferred academy total gzip',
    deferredAcademy.reduce((sum, file) => sum + gzipSize(file), 0),
    26_000,
  );
  assertBudget(
    'Admin total JavaScript gzip',
    javascriptGzip.reduce((sum, size) => sum + size, 0),
    // UI audit fixes (draft guards, persisted filters and load recovery)
    // measure 449,528 B after shared guard/input deduplication.
    // Employee login/nav adds under 1 KiB to that shared shell; keep narrow
    // headroom and retain the largest-chunk limit.
    // Exporters load only on download and keep their separate budgets below.
    451_584,
  );
  assertBudget('Admin largest JavaScript gzip', Math.max(0, ...javascriptGzip), 82_000);
  assertBudget('Admin deferred price-label PDF gzip', Math.max(0, ...priceLabelPdfGzip), 185_000);
  assertBudget('Admin deferred price-label Corel gzip', Math.max(0, ...priceLabelCorelGzip), 2_000);
  // Shared premium control states measure 33,956 B; keep 544 B headroom.
  // Replacing the stock icon library reduces core JS to 440,418 B.
  assertBudget('Admin largest CSS gzip', Math.max(0, ...styleGzip), 34_500);
}

const flutterDirectory = option('--flutter');
if (flutterDirectory) {
  const directory = path.resolve(flutterDirectory);
  const mainFile = path.join(directory, 'main.dart.js');
  if (!fs.existsSync(mainFile)) {
    failures.push(`Flutter entry is missing: ${mainFile}`);
  } else {
    // Interrupted-motion handling and scoped in-flight reads with mutation
    // barriers measure 6,725,501 B raw / 1,835,093 B gzip: +3,542 B raw /
    // +2,457 B gzip (0.13% transfer growth) from the performance release.
    // Retain narrow headroom; native artwork adds no startup request on web.
    // The QR decoder remains deferred with a separate total budget below.
    assertBudget('Flutter main.dart.js', fs.statSync(mainFile).size, 6_726_500);
    assertBudget('Flutter main.dart.js gzip', gzipSize(mainFile), 1_835_600);
  }
  const deferredChunks = filesUnder(directory).filter((file) => /\.part\.js$/.test(file));
  // One locally decoded QR chunk measures 56,453 B raw / 19,842 B gzip.
  assertBudget(
    'Flutter deferred JavaScript total',
    deferredChunks.reduce((sum, file) => sum + fs.statSync(file).size, 0),
    58_000,
  );
  assertBudget(
    'Flutter deferred JavaScript total gzip',
    deferredChunks.reduce((sum, file) => sum + gzipSize(file), 0),
    21_000,
  );
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
