'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertGitFacts,
  checkReleaseProvenance,
  downloadWorkflowArtifact,
  parseGitHubRepository,
  parseRemoteMainSha,
  requireProductionArtifact,
  requireSuccessfulWorkflowRun,
} = require('../scripts/check-release-provenance');

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const REPOSITORY = 'Amandyk7292/iiko-bonus';

function successfulRun(overrides = {}) {
  return {
    id: 1234,
    run_attempt: 1,
    head_sha: SHA,
    head_branch: 'main',
    head_repository: { full_name: REPOSITORY },
    event: 'push',
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    updated_at: '2026-08-08T10:00:00Z',
    html_url: 'https://github.com/Amandyk7292/iiko-bonus/actions/runs/1234',
    ...overrides,
  };
}

function productionArtifact(overrides = {}) {
  return {
    id: 5678,
    name: `production-web-${SHA}`,
    size_in_bytes: 123,
    expired: false,
    digest: `sha256:${'c'.repeat(64)}`,
    workflow_run: { id: 1234 },
    ...overrides,
  };
}

test('GitHub repository parser accepts HTTPS and SSH origins', () => {
  assert.equal(parseGitHubRepository('https://github.com/Amandyk7292/iiko-bonus.git'), REPOSITORY);
  assert.equal(parseGitHubRepository('git@github.com:Amandyk7292/iiko-bonus.git'), REPOSITORY);
  assert.equal(
    parseGitHubRepository('ssh://git@github.com/Amandyk7292/iiko-bonus.git'),
    REPOSITORY,
  );
  assert.throws(() => parseGitHubRepository('https://example.com/team/repo.git'), /github\.com/);
});

test('remote main parser requires the exact branch and full SHA', () => {
  assert.equal(parseRemoteMainSha(`${SHA}\trefs/heads/main\n`), SHA);
  assert.throws(() => parseRemoteMainSha(`${SHA}\trefs/heads/release\n`), /origin\/main/);
  assert.throws(() => parseRemoteMainSha('abc\trefs/heads/main\n'), /full commit SHA/);
});

test('git facts reject dirty, non-main, and unpublished commits', () => {
  assert.doesNotThrow(() =>
    assertGitFacts({ status: '', branch: 'main', headSha: SHA, remoteMainSha: SHA }),
  );
  assert.throws(
    () =>
      assertGitFacts({ status: ' M src/app.js', branch: 'main', headSha: SHA, remoteMainSha: SHA }),
    /clean working tree/,
  );
  assert.throws(
    () => assertGitFacts({ status: '', branch: 'feature', headSha: SHA, remoteMainSha: SHA }),
    /requires branch main/,
  );
  assert.throws(
    () => assertGitFacts({ status: '', branch: 'main', headSha: SHA, remoteMainSha: OTHER_SHA }),
    /not the current origin\/main/,
  );
});

test('the newest exact CI run must be completed successfully', () => {
  const olderSuccess = successfulRun({ id: 1, updated_at: '2026-08-08T09:00:00Z' });
  const newerFailure = successfulRun({
    id: 2,
    updated_at: '2026-08-08T11:00:00Z',
    conclusion: 'failure',
  });
  assert.throws(
    () =>
      requireSuccessfulWorkflowRun([olderSuccess, newerFailure], {
        headSha: SHA,
        repository: REPOSITORY,
      }),
    /completed\/failure/,
  );
  assert.equal(
    requireSuccessfulWorkflowRun([olderSuccess], { headSha: SHA, repository: REPOSITORY }).id,
    1,
  );
  assert.throws(
    () =>
      requireSuccessfulWorkflowRun([successfulRun({ head_sha: OTHER_SHA })], {
        headSha: SHA,
        repository: REPOSITORY,
      }),
    /No \.github\/workflows\/ci\.yml push run/,
  );
});

test('production artifact must be exact, unique, current, and unexpired', () => {
  assert.equal(
    requireProductionArtifact([productionArtifact()], {
      headSha: SHA,
      workflowRunId: 1234,
    }).id,
    5678,
  );
  assert.throws(
    () =>
      requireProductionArtifact([productionArtifact({ expired: true })], {
        headSha: SHA,
        workflowRunId: 1234,
      }),
    /expired/,
  );
  assert.throws(
    () =>
      requireProductionArtifact([], {
        headSha: SHA,
        workflowRunId: 1234,
      }),
    /exactly one/,
  );
  assert.throws(
    () =>
      requireProductionArtifact([productionArtifact({ size_in_bytes: 300 * 1024 * 1024 })], {
        headSha: SHA,
        workflowRunId: 1234,
      }),
    /excessive archive size/,
  );
});

test('full provenance check is deterministic with offline Git and HTTP mocks', async () => {
  const commands = new Map([
    ['status --porcelain=v1 --untracked-files=all', ''],
    ['rev-parse --abbrev-ref HEAD', 'main'],
    ['rev-parse HEAD', SHA],
    ['remote get-url origin', 'https://github.com/Amandyk7292/iiko-bonus.git'],
    ['ls-remote --exit-code origin refs/heads/main', `${SHA}\trefs/heads/main`],
  ]);
  const requestedUrls = [];
  const result = await checkReleaseProvenance({
    cwd: process.cwd(),
    token: 'test-token',
    gitRunner(args) {
      const key = args.join(' ');
      assert.ok(commands.has(key), `Unexpected Git command: ${key}`);
      return commands.get(key);
    },
    async fetchImpl(url, options) {
      requestedUrls.push(url);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (url.includes('/actions/runs/1234/artifacts')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { artifacts: [productionArtifact()] };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { workflow_runs: [successfulRun()] };
        },
      };
    },
  });
  assert.equal(result.commitSha, SHA);
  assert.equal(result.workflowRunId, 1234);
  assert.equal(result.artifactId, 5678);
  assert.match(requestedUrls[0], /actions\/workflows\/ci\.yml\/runs/);
  assert.match(requestedUrls[0], new RegExp(`head_sha=${SHA}`));
  assert.match(requestedUrls[1], /actions\/runs\/1234\/artifacts/);
});

test('artifact download verifies GitHub digest before an atomic write', async (t) => {
  const bytes = Buffer.from('attested CI artifact');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulka-provenance-'));
  const destination = path.join(temporaryDirectory, 'artifact.zip');
  t.after(() => fs.rmSync(temporaryDirectory, { force: true, recursive: true }));

  const result = await downloadWorkflowArtifact({
    repository: REPOSITORY,
    artifact: productionArtifact({ digest: `sha256:${digest}` }),
    token: 'test-token',
    destination,
    async fetchImpl(url, options) {
      assert.match(url, /actions\/artifacts\/5678\/zip$/);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return bytes;
        },
      };
    },
  });
  assert.equal(result.archiveSha256, digest);
  assert.deepEqual(fs.readFileSync(destination), bytes);

  await assert.rejects(
    () =>
      downloadWorkflowArtifact({
        repository: REPOSITORY,
        artifact: productionArtifact({ digest: `sha256:${'0'.repeat(64)}` }),
        token: 'test-token',
        destination: path.join(temporaryDirectory, 'bad.zip'),
        async fetchImpl() {
          return {
            ok: true,
            status: 200,
            async arrayBuffer() {
              return bytes;
            },
          };
        },
      }),
    /does not match the GitHub SHA-256 digest/,
  );

  await assert.rejects(
    () =>
      downloadWorkflowArtifact({
        repository: REPOSITORY,
        artifact: productionArtifact({ digest: `sha256:${digest}` }),
        destination: path.join(temporaryDirectory, 'unauthenticated.zip'),
        async fetchImpl() {
          throw new Error('fetch must not run without a token');
        },
      }),
    /GITHUB_TOKEN with Actions: read/,
  );
});
