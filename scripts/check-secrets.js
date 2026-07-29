#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const maximumFileBytes = 5 * 1024 * 1024;
const ignoredBasenames = new Set(['package-lock.json']);
const blockedSecretContainerExtensions = new Set([
  '.jks',
  '.keystore',
  '.mobileprovision',
  '.p12',
  '.pfx',
]);
const ignoredExtensions = new Set([
  '.aab',
  '.apk',
  '.cer',
  '.dll',
  '.exe',
  '.ico',
  '.jar',
  '.jpg',
  '.jpeg',
  '.pdf',
  '.png',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);
const publicFirebaseConfigFiles = new Set([
  'BulkaAndroid/android/app/google-services.json',
  'BulkaAndroid/lib/firebase_options.dart',
  'BulkaAndroid/web/firebase-messaging-sw.js',
]);

const tokenRules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g],
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  [
    'database-password',
    /\b(?:postgres(?:ql)?|mysql):\/\/[^:\s/]+:[^@\s/$<{[][^@\s]*@[A-Za-z0-9.-]+/gi,
  ],
];

const assignmentPattern =
  /\b([A-Z0-9_]*(?:PASSWORD|PRIVATE_KEY|SECRET(?:_KEY)?|TOKEN_KEY)[A-Z0-9_]*)\s*[:=]\s*["']([^"'\r\n]{16,})["']/g;
const safeValuePattern =
  /(?:example|placeholder|replace[-_ ]?me|your[-_ ]|test[-_ ]|dummy|fake|xxxx|\$\{|process\.env|(?:current|previous)-.*longer-than-thirty-two)/i;

const shannonEntropy = (value) => {
  const frequencies = new Map();
  for (const character of value) frequencies.set(character, (frequencies.get(character) || 0) + 1);
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
};

const lineNumberAt = (text, index) => text.slice(0, index).split('\n').length;
const findings = [];
const report = (file, text, index, rule) => {
  findings.push({ file, line: lineNumberAt(text, index), rule });
};

const trackedOutput = execFileSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});

for (const relativeFile of trackedOutput.split('\0').filter(Boolean)) {
  const absoluteFile = path.join(repositoryRoot, relativeFile);
  const extension = path.extname(relativeFile).toLowerCase();
  if (blockedSecretContainerExtensions.has(extension)) {
    findings.push({ file: relativeFile, line: 1, rule: 'private-key-container' });
    continue;
  }
  if (ignoredBasenames.has(path.basename(relativeFile)) || ignoredExtensions.has(extension)) continue;
  let stats;
  try {
    stats = fs.statSync(absoluteFile);
  } catch {
    continue;
  }
  if (!stats.isFile() || stats.size > maximumFileBytes) continue;
  const text = fs.readFileSync(absoluteFile, 'utf8');
  if (text.includes('\0')) continue;

  for (const [rule, expression] of tokenRules) {
    if (rule === 'google-api-key' && publicFirebaseConfigFiles.has(relativeFile)) continue;
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) report(relativeFile, text, match.index, rule);
  }

  assignmentPattern.lastIndex = 0;
  for (const match of text.matchAll(assignmentPattern)) {
    if (match[1].endsWith('_HASH')) continue;
    const value = match[2].trim();
    if (safeValuePattern.test(value)) continue;
    if (value.length >= 20 && shannonEntropy(value) >= 3.5) {
      report(relativeFile, text, match.index, `high-entropy-${match[1].toLowerCase()}`);
    }
  }
}

if (findings.length) {
  console.error('Potential committed secrets detected (values are intentionally hidden):');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}]`);
  }
  console.error('Remove the value from Git and rotate the credential before continuing.');
  process.exitCode = 1;
} else {
  console.log('No committed secrets detected.');
}
