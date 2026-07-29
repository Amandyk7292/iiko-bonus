#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '..');
const routesRoot = path.join(repositoryRoot, 'src', 'routes');
const minimum = Number(
  process.argv.find((argument) => argument.startsWith('--minimum='))?.split('=')[1] || 0,
);
const minimumPercentage = Number(
  process.argv.find((argument) => argument.startsWith('--minimum-percentage='))?.split('=')[1] || 0,
);

const routeFiles = [];
const collect = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else if (entry.isFile() && entry.name.endsWith('.js')) routeFiles.push(absolute);
  }
};
collect(routesRoot);

const findCallEnd = (source, openingIndex) => {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const routes = [];
const declarationPattern = /\brouter\.(get|post|put|patch|delete)\s*\(/g;
for (const absoluteFile of routeFiles) {
  const source = fs.readFileSync(absoluteFile, 'utf8');
  for (const match of source.matchAll(declarationPattern)) {
    const openingIndex = match.index + match[0].lastIndexOf('(');
    const endIndex = findCallEnd(source, openingIndex);
    if (endIndex < 0) continue;
    const call = source.slice(match.index, endIndex + 1);
    const line = source.slice(0, match.index).split('\n').length;
    routes.push({
      method: match[1].toUpperCase(),
      file: path.relative(repositoryRoot, absoluteFile).replaceAll(path.sep, '/'),
      line,
      validated: /\bvalidateRequest\s*\(/.test(call),
    });
  }
}

const mutations = routes.filter((route) => route.method !== 'GET');
const validatedMutations = mutations.filter((route) => route.validated);
const percentage = mutations.length ? (validatedMutations.length / mutations.length) * 100 : 100;

console.log(
  `API contracts: ${validatedMutations.length}/${mutations.length} mutation routes (${percentage.toFixed(1)}%) use validateRequest.`,
);
if (validatedMutations.length < minimum || percentage < minimumPercentage) {
  if (validatedMutations.length < minimum) {
    console.error(`Contract coverage fell below the count ratchet of ${minimum}.`);
  }
  if (percentage < minimumPercentage) {
    console.error(
      `Contract coverage fell below the percentage ratchet of ${minimumPercentage.toFixed(1)}%.`,
    );
  }
  for (const route of mutations.filter((item) => !item.validated).slice(0, 20)) {
    console.error(`${route.file}:${route.line} ${route.method} is missing validateRequest`);
  }
  process.exitCode = 1;
}
