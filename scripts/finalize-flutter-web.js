#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');
const releasePlaceholder = '__BULKA_RELEASE_VERSION__';
const releaseVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/;

const sha256File = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const resolveReleaseVersion = (explicitVersion) => {
  const candidate = String(
    explicitVersion ||
      process.env.BULKA_RELEASE_VERSION ||
      execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
      }),
  ).trim();
  if (!releaseVersionPattern.test(candidate)) {
    throw new Error('Flutter release version must be 6-64 URL-safe characters');
  }
  return candidate;
};

const versionDeferredChunks = (buildDirectory, mainBundlePath, version) => {
  const originalMain = fs.readFileSync(mainBundlePath, 'utf8');
  const names = [...new Set(originalMain.match(/main\.dart\.js_\d+\.part\.js/g) || [])];
  const chunks = names.map((name) => {
    const sourcePath = path.join(buildDirectory, name);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Required Flutter deferred chunk is missing: ${sourcePath}`);
    }
    const content = fs.readFileSync(sourcePath, 'utf8');
    const fingerprint = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    // The release also changes the URL when another deferred chunk it refers
    // to changes. This keeps immutable browser caches safe across releases.
    const file = name.replace('.part.js', `.${version}-${fingerprint}.part.js`);
    return { name, file, content };
  });
  const replaceNames = (content) => chunks.reduce(
    (result, chunk) => result.replaceAll(chunk.name, chunk.file), content,
  );
  for (const chunk of chunks) {
    const targetPath = path.join(buildDirectory, chunk.file);
    fs.writeFileSync(targetPath, replaceNames(chunk.content), 'utf8');
    fs.unlinkSync(path.join(buildDirectory, chunk.name));
  }
  if (chunks.length) fs.writeFileSync(mainBundlePath, replaceNames(originalMain), 'utf8');
  // Flutter can reuse an output directory. Remove only obsolete generated
  // chunk names so repeated normal builds do not package/cache stale decoders.
  const currentNames = new Set(chunks.map(({ file }) => file));
  for (const entry of fs.readdirSync(buildDirectory)) {
    if (/^main\.dart\.js_\d+\.[A-Za-z0-9][A-Za-z0-9._-]{5,63}-[a-f0-9]{16}\.part\.js$/.test(entry)
        && !currentNames.has(entry)) {
      fs.unlinkSync(path.join(buildDirectory, entry));
    }
  }
  return chunks.map(({ file }) => ({
    file,
    sha256: sha256File(path.join(buildDirectory, file)),
  }));
};

const finalizeFlutterWebBuild = ({ directory, version }) => {
  const buildDirectory = path.resolve(directory);
  const indexPath = path.join(buildDirectory, 'index.html');
  const mainBundlePath = path.join(buildDirectory, 'main.dart.js');
  const workerSourcePath = path.join(
    projectRoot,
    'BulkaAndroid',
    'web',
    'flutter_service_worker.js',
  );
  const workerOutputPath = path.join(buildDirectory, 'flutter_service_worker.js');
  const manifestPath = path.join(buildDirectory, 'release-version.json');

  for (const requiredPath of [indexPath, mainBundlePath, workerSourcePath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Required Flutter web file is missing: ${requiredPath}`);
    }
  }

  const resolvedVersion = resolveReleaseVersion(version);
  const index = fs.readFileSync(indexPath, 'utf8');
  if (!index.includes(releasePlaceholder)) {
    throw new Error(`Flutter index does not contain ${releasePlaceholder}`);
  }

  const deferredChunks = versionDeferredChunks(buildDirectory, mainBundlePath, resolvedVersion);

  fs.writeFileSync(indexPath, index.replaceAll(releasePlaceholder, resolvedVersion), 'utf8');
  fs.copyFileSync(workerSourcePath, workerOutputPath);
  // Compress once during the build, rather than on every cold client request.
  const mainBundle = fs.readFileSync(mainBundlePath);
  fs.writeFileSync(`${mainBundlePath}.br`, zlib.brotliCompressSync(mainBundle, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }));
  fs.writeFileSync(`${mainBundlePath}.gz`, zlib.gzipSync(mainBundle, { level: 9 }));

  const manifest = {
    schemaVersion: 1,
    version: resolvedVersion,
    mainSha256: sha256File(mainBundlePath),
    deferredChunks,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
};

const parseArguments = (argumentsList) => {
  const result = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--directory' || argument === '--version') {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      result[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.directory) throw new Error('--directory is required');
  return result;
};

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  const manifest = finalizeFlutterWebBuild(options);
  process.stdout.write(
    `Flutter web finalized: version=${manifest.version} main=${manifest.mainSha256}\n`,
  );
}

module.exports = {
  finalizeFlutterWebBuild,
  releasePlaceholder,
  resolveReleaseVersion,
  sha256File,
};
