const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('external production monitor covers availability, provenance, TLS host and alerts', () => {
  const monitor = read('scripts/check-production-edge.mjs');
  const workflow = read('.github/workflows/production-monitor.yml');

  assert.match(monitor, /\/healthz/);
  assert.match(monitor, /\/readyz/);
  assert.match(monitor, /\/release-version\.json/);
  assert.match(monitor, /www-canonical-redirect/);
  assert.match(monitor, /cf-ray/i);
  assert.match(workflow, /cron: '\*\/10 \* \* \* \*'/);
  assert.match(workflow, /PRODUCTION_MONITOR_WEBHOOK_URL/);
  assert.match(workflow, /https:\/\/\*/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /gh issue (?:create|edit)/);
  assert.match(workflow, /\[monitor\] Production edge is unhealthy/);
  assert.match(workflow, /if: failure\(\)/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /permissions:\s*write-all/);
});

test('SSH hardening is guarded, validated and recoverable', () => {
  const script = read('scripts/harden-vps-ssh.sh');

  assert.match(script, /CONFIRM_DEPLOY_KEY_LOGIN/);
  assert.match(script, /EXPECTED_DEPLOY_KEY_FINGERPRINT/);
  assert.match(script, /ssh-keygen -lf/);
  assert.match(script, /PermitRootLogin no/);
  assert.match(script, /PasswordAuthentication no/);
  assert.match(script, /X11Forwarding no/);
  assert.match(script, /sshd -t/);
  assert.match(script, /fail2ban/);
  assert.match(script, /rollback\(\)/);
  assert.match(script, /\/var\/backups\/bulka-ssh-/);
});

test('www activation refuses DNS mismatch and verifies canonical redirect', () => {
  const script = read('scripts/activate-www-domain.sh');

  assert.match(script, /CONFIRM_DNS_WWW/);
  assert.match(script, /EXPECTED_ORIGIN_IP/);
  assert.match(script, /getent ahostsv4/);
  assert.match(script, /certbot certonly --webroot/);
  assert.match(script, /return 308 https:\/\/\$\{domain\}/);
  assert.match(script, /nginx -t/);
  assert.match(script, /rollback\(\)/);
});

test('www activation ignores resolver-generated IPv4-mapped IPv6 addresses', () => {
  const script = read('scripts/activate-www-domain.sh');
  const filter = script.match(/filter_native_ipv6_addresses\(\) \{[\s\S]*?^\}/m);
  assert.ok(filter, 'native IPv6 filter must remain independently testable');

  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  const result = spawnSync(bash, ['-c', `${filter[0]}\nfilter_native_ipv6_addresses`], {
    cwd: root,
    encoding: 'utf8',
    input: [
      '::ffff:185.113.132.73 STREAM',
      '0:0:0:0:0:ffff:b971:8449 STREAM',
      '2001:db8::73 STREAM',
      '',
    ].join('\n'),
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), '2001:db8::73');
});

test('Cloudflare origin lockdown validates every range before mutation and rolls back', () => {
  const script = read('scripts/prepare-cloudflare-origin.sh');
  const validation = script.indexOf(
    'def validate(filename: str, version: int, expected_count: int)',
  );
  const backup = script.indexOf('install -d -m 0700 "$backup_dir"');
  const mutation = script.indexOf('>"$nginx_conf"');
  const directVerification = script.indexOf("if [[ $direct_status != '403' ]]");

  assert.ok(
    validation >= 0 && validation < backup,
    'CIDRs must be validated before backup/mutation',
  );
  assert.ok(backup >= 0 && backup < mutation, 'backup must precede Nginx mutation');
  assert.ok(directVerification > mutation, 'direct-origin verification must follow mutation');
  assert.match(script, /ipaddress\.ip_network\(raw_network, strict=True\)/);
  assert.match(script, /len\(raw_networks\) != expected_count/);
  assert.match(script, /len\(set\(networks\)\) != expected_count/);
  assert.match(script, /validate\(sys\.argv\[1\], 4, 15\)/);
  assert.match(script, /validate\(sys\.argv\[2\], 6, 7\)/);
  assert.match(
    script.slice(directVerification),
    /Direct origin request returned[\s\S]*false[\s\S]*trap - ERR/,
  );
  assert.doesNotMatch(
    script.slice(directVerification, script.indexOf('trap - ERR', directVerification)),
    /exit 1/,
  );
});
