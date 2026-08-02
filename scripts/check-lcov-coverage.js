const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const fileArgument = args.find((argument) => !argument.startsWith('--'));
const minimumArgument = args.find((argument) => argument.startsWith('--minimum='));
const minimum = Number(minimumArgument?.slice('--minimum='.length) || 0);

if (!fileArgument || !Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
  console.error('Usage: node scripts/check-lcov-coverage.js <lcov.info> --minimum=<percent>');
  process.exitCode = 2;
} else {
  const file = path.resolve(fileArgument);
  if (!fs.existsSync(file)) {
    console.error(`Coverage report is missing: ${file}`);
    process.exitCode = 1;
  } else {
    let linesFound = 0;
    let linesHit = 0;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('LF:')) linesFound += Number(line.slice(3)) || 0;
      if (line.startsWith('LH:')) linesHit += Number(line.slice(3)) || 0;
    }
    const coverage = linesFound ? (linesHit / linesFound) * 100 : 0;
    if (coverage + Number.EPSILON < minimum) {
      console.error(
        `Line coverage ${coverage.toFixed(2)}% is below the required ${minimum.toFixed(2)}%.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`Line coverage ${coverage.toFixed(2)}% passed the ${minimum.toFixed(2)}% gate.`);
    }
  }
}
