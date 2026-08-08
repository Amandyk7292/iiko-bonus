'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_BRANCH = 'main';
const WORKFLOW_FILE = 'ci.yml';
const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_ARTIFACT_ARCHIVE_BYTES = 256 * 1024 * 1024;

function runGit(args, cwd) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Could not run Git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Git ${args[0]} failed${detail ? `: ${detail}` : '.'}`);
  }
  return String(result.stdout || '').trim();
}

function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  let match = value.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match) {
    match = value.match(
      /^(?:https?|ssh):\/\/(?:[^/@]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
    );
  }
  if (!match) {
    throw new Error('The origin remote must point to github.com/OWNER/REPOSITORY.');
  }
  return `${match[1]}/${match[2]}`;
}

function parseRemoteMainSha(lsRemoteOutput) {
  const lines = String(lsRemoteOutput || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const match = lines
    .map((line) => line.split(/\s+/))
    .find((parts) => parts[1] === `refs/heads/${REQUIRED_BRANCH}`);
  if (!match || !SHA_PATTERN.test(match[0])) {
    throw new Error(`origin/${REQUIRED_BRANCH} did not resolve to a full commit SHA.`);
  }
  return match[0];
}

function assertGitFacts({ status, branch, headSha, remoteMainSha }) {
  if (String(status || '').trim()) {
    throw new Error('Release provenance requires a clean working tree.');
  }
  if (branch !== REQUIRED_BRANCH) {
    throw new Error(
      `Release provenance requires branch ${REQUIRED_BRANCH}; found ${branch || 'detached HEAD'}.`,
    );
  }
  if (!SHA_PATTERN.test(String(headSha || ''))) {
    throw new Error('HEAD did not resolve to a full commit SHA.');
  }
  if (headSha !== remoteMainSha) {
    throw new Error(
      `HEAD ${headSha} is not the current origin/${REQUIRED_BRANCH} commit ${remoteMainSha}. Push it and wait for CI.`,
    );
  }
}

function workflowRunSortKey(run) {
  const timestamp = Date.parse(run.updated_at || run.created_at || '') || 0;
  const attempt = Number(run.run_attempt || 0);
  const id = Number(run.id || 0);
  return [timestamp, attempt, id];
}

function compareWorkflowRuns(left, right) {
  const leftKey = workflowRunSortKey(left);
  const rightKey = workflowRunSortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] !== rightKey[index]) return rightKey[index] - leftKey[index];
  }
  return 0;
}

function requireSuccessfulWorkflowRun(workflowRuns, { headSha, repository }) {
  const candidates = (Array.isArray(workflowRuns) ? workflowRuns : [])
    .filter(
      (run) =>
        run &&
        run.head_sha === headSha &&
        run.head_branch === REQUIRED_BRANCH &&
        run.event === 'push' &&
        run.path === WORKFLOW_PATH &&
        (!run.head_repository?.full_name ||
          run.head_repository.full_name.toLowerCase() === repository.toLowerCase()),
    )
    .sort(compareWorkflowRuns);

  if (candidates.length === 0) {
    throw new Error(`No ${WORKFLOW_PATH} push run exists for ${headSha}.`);
  }
  const latest = candidates[0];
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(
      `Latest ${WORKFLOW_PATH} run for ${headSha} is ${latest.status || 'unknown'}/${latest.conclusion || 'none'}.`,
    );
  }
  return latest;
}

async function loadWorkflowRuns({ fetchImpl, repository, headSha, token }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This release gate requires Node.js with the Fetch API.');
  }
  const query = new URLSearchParams({
    branch: REQUIRED_BRANCH,
    event: 'push',
    head_sha: headSha,
    per_page: '20',
  });
  const url =
    `https://api.github.com/repos/${repository}/actions/workflows/` +
    `${encodeURIComponent(WORKFLOW_FILE)}/runs?${query}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'bulka-release-provenance-gate',
    'X-GitHub-Api-Version': '2026-03-10',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, { headers });
  if (!response || !response.ok) {
    const status = response
      ? `${response.status} ${response.statusText || ''}`.trim()
      : 'no response';
    const hint = token
      ? 'Check that GITHUB_TOKEN can read Actions for this repository.'
      : 'Set GITHUB_TOKEN if the repository is private or the anonymous API limit was reached.';
    throw new Error(`GitHub Actions lookup failed (${status}). ${hint}`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.workflow_runs)) {
    throw new Error('GitHub Actions returned an invalid workflow-runs response.');
  }
  return payload.workflow_runs;
}

function requireProductionArtifact(artifacts, { headSha, workflowRunId }) {
  const expectedName = `production-web-${headSha}`;
  const matches = (Array.isArray(artifacts) ? artifacts : []).filter(
    (artifact) =>
      artifact &&
      artifact.name === expectedName &&
      Number(artifact.workflow_run?.id || workflowRunId) === Number(workflowRunId),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${expectedName} artifact on CI run ${workflowRunId}; found ${matches.length}.`,
    );
  }
  const artifact = matches[0];
  if (artifact.expired) {
    throw new Error(
      `${expectedName} has expired. Re-run CI for this exact commit before deployment.`,
    );
  }
  if (!Number.isSafeInteger(Number(artifact.id)) || Number(artifact.id) <= 0) {
    throw new Error(`${expectedName} has an invalid GitHub artifact id.`);
  }
  const artifactSize = Number(artifact.size_in_bytes);
  if (
    !Number.isSafeInteger(artifactSize) ||
    artifactSize <= 0 ||
    artifactSize > MAX_ARTIFACT_ARCHIVE_BYTES
  ) {
    throw new Error(`${expectedName} has an invalid or excessive archive size.`);
  }
  if (!/^sha256:[0-9a-f]{64}$/i.test(String(artifact.digest || ''))) {
    throw new Error(`${expectedName} has no valid GitHub SHA-256 artifact digest.`);
  }
  return artifact;
}

async function loadWorkflowArtifacts({ fetchImpl, repository, workflowRunId, token }) {
  const url =
    `https://api.github.com/repos/${repository}/actions/runs/${workflowRunId}/artifacts?` +
    new URLSearchParams({ per_page: '100' });
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'bulka-release-provenance-gate',
    'X-GitHub-Api-Version': '2026-03-10',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers });
  if (!response || !response.ok) {
    const status = response
      ? `${response.status} ${response.statusText || ''}`.trim()
      : 'no response';
    const hint = token
      ? 'Check that GITHUB_TOKEN can read Actions artifacts for this repository.'
      : 'Set GITHUB_TOKEN if Actions artifacts are not anonymously readable.';
    throw new Error(`GitHub artifact lookup failed (${status}). ${hint}`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.artifacts)) {
    throw new Error('GitHub Actions returned an invalid artifacts response.');
  }
  return payload.artifacts;
}

async function downloadWorkflowArtifact({ fetchImpl, repository, artifact, token, destination }) {
  if (!destination) throw new Error('An artifact download destination is required.');
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN with Actions: read permission is required to download the attested CI artifact.',
    );
  }
  const absoluteDestination = path.resolve(destination);
  if (fs.existsSync(absoluteDestination)) {
    throw new Error(`Artifact destination already exists: ${absoluteDestination}`);
  }
  const url = `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'bulka-release-provenance-gate',
    'X-GitHub-Api-Version': '2026-03-10',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers, redirect: 'follow' });
  if (!response || !response.ok) {
    const status = response
      ? `${response.status} ${response.statusText || ''}`.trim()
      : 'no response';
    const hint = token
      ? 'Check that GITHUB_TOKEN has Actions: read permission.'
      : 'Set GITHUB_TOKEN with Actions: read permission.';
    throw new Error(`GitHub artifact download failed (${status}). ${hint}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('GitHub returned an empty artifact archive.');
  if (bytes.length > MAX_ARTIFACT_ARCHIVE_BYTES) {
    throw new Error('Downloaded CI artifact exceeds the 256 MiB release limit.');
  }
  const archiveSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const expectedDigest = String(artifact.digest || '')
    .toLowerCase()
    .replace(/^sha256:/, '');
  if (
    expectedDigest &&
    (!SHA256_PATTERN.test(expectedDigest) || archiveSha256 !== expectedDigest)
  ) {
    throw new Error('Downloaded artifact archive does not match the GitHub SHA-256 digest.');
  }

  fs.mkdirSync(path.dirname(absoluteDestination), { recursive: true });
  const temporaryPath = `${absoluteDestination}.partial-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, absoluteDestination);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original download/write error.
    }
    throw error;
  }
  return { archiveSha256, sizeInBytes: bytes.length, destination: absoluteDestination };
}

async function checkReleaseProvenance({
  cwd,
  token = '',
  gitRunner = runGit,
  fetchImpl = globalThis.fetch,
} = {}) {
  const projectRoot = path.resolve(cwd || process.cwd());
  const git = (args) => gitRunner(args, projectRoot);
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const headSha = git(['rev-parse', 'HEAD']);
  const originUrl = git(['remote', 'get-url', 'origin']);
  const repository = parseGitHubRepository(originUrl);
  const remoteMainSha = parseRemoteMainSha(
    git(['ls-remote', '--exit-code', 'origin', `refs/heads/${REQUIRED_BRANCH}`]),
  );
  assertGitFacts({ status, branch, headSha, remoteMainSha });

  const workflowRuns = await loadWorkflowRuns({
    fetchImpl,
    repository,
    headSha,
    token,
  });
  const workflowRun = requireSuccessfulWorkflowRun(workflowRuns, { headSha, repository });
  const artifacts = await loadWorkflowArtifacts({
    fetchImpl,
    repository,
    workflowRunId: workflowRun.id,
    token,
  });
  const artifact = requireProductionArtifact(artifacts, {
    headSha,
    workflowRunId: workflowRun.id,
  });
  return {
    verified: true,
    repository,
    branch,
    commitSha: headSha,
    workflow: WORKFLOW_PATH,
    workflowRunId: workflowRun.id,
    workflowRunAttempt: workflowRun.run_attempt || 1,
    workflowRunUrl: workflowRun.html_url || '',
    workflowConclusion: workflowRun.conclusion,
    artifactId: artifact.id,
    artifactName: artifact.name,
    artifactSizeInBytes: artifact.size_in_bytes || null,
    artifactDigest: artifact.digest || '',
    verifiedAt: new Date().toISOString(),
  };
}

function parseArguments(argv) {
  const options = { cwd: process.cwd(), json: false, downloadArtifact: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--cwd') {
      options.cwd = argv[index + 1];
      index += 1;
    } else if (value === '--json') {
      options.json = true;
    } else if (value === '--download-artifact') {
      options.downloadArtifact = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await checkReleaseProvenance({
    cwd: options.cwd,
    token: process.env.GITHUB_TOKEN || '',
  });
  if (options.downloadArtifact) {
    const download = await downloadWorkflowArtifact({
      fetchImpl: globalThis.fetch,
      repository: result.repository,
      artifact: {
        id: result.artifactId,
        name: result.artifactName,
        digest: result.artifactDigest,
      },
      token: process.env.GITHUB_TOKEN || '',
      destination: options.downloadArtifact,
    });
    result.downloadedArchiveSha256 = download.archiveSha256;
    result.downloadedArchiveSizeInBytes = download.sizeInBytes;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(
    `[release-provenance] verified ${result.commitSha.slice(0, 12)} on ` +
      `${result.repository}: ${result.workflow} run ${result.workflowRunId} succeeded.\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[release-provenance] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_BRANCH,
  WORKFLOW_PATH,
  assertGitFacts,
  checkReleaseProvenance,
  downloadWorkflowArtifact,
  loadWorkflowArtifacts,
  loadWorkflowRuns,
  parseGitHubRepository,
  parseRemoteMainSha,
  requireProductionArtifact,
  requireSuccessfulWorkflowRun,
};
