const BLOCKED_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);
const MAX_TARGET_LENGTH = 8192;

const RULES = [
  {
    id: 'sensitive-resource-probe',
    pattern:
      /(?:^|[/\\])(?:\.env(?:[./?\\]|$)|\.git(?:[/\\?]|$)|wp-admin(?:[/\\?]|$)|wp-login\.php(?:[?]|$)|phpmyadmin(?:[/\\?]|$)|actuator(?:[/\\?]|$)|vendor[/\\]phpunit(?:[/\\?]|$)|cgi-bin(?:[/\\?]|$))/i,
  },
  {
    id: 'path-traversal-or-lfi',
    pattern:
      /(?:\.\.[/\\]|[/\\]etc[/\\]passwd\b|[/\\]proc[/\\]self[/\\]environ\b|[/\\](?:bin|usr[/\\]bin)[/\\](?:ba)?sh\b|[/\\]windows[/\\](?:system32[/\\])?win\.ini\b)/i,
  },
  {
    id: 'sql-injection',
    pattern:
      /(?:\bunion(?:\s+all)?\s+select\b|\binformation_schema\b|['"`]\s*(?:or|and)\s+\d+\s*=\s*\d+|\b(?:sleep|benchmark|load_file)\s*\()/i,
  },
  {
    id: 'cross-site-scripting',
    pattern: /(?:<\s*script\b|javascript\s*:|\bon(?:error|load|click|mouseover)\s*=)/i,
  },
  {
    id: 'remote-code-execution',
    pattern:
      /(?:\$\{jndi\s*:|[;&|`]\s*(?:(?:[/\\](?:usr[/\\])?bin[/\\])?(?:ba)?sh|curl|wget|nc|powershell|cmd)(?:\s|$))/i,
  },
];

const decodeRequestTarget = (value) => {
  let decoded = String(value || '/')
    .slice(0, MAX_TARGET_LENGTH)
    .replace(/\+/g, ' ');
  for (let layer = 0; layer < 2; layer += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
};

const inspectRequest = (req) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (BLOCKED_METHODS.has(method)) return 'dangerous-http-method';

  const requestTarget = decodeRequestTarget(req.originalUrl || req.url);
  const forwardedTarget = decodeRequestTarget(
    req.headers?.['x-original-url'] || req.headers?.['x-rewrite-url'] || '',
  );
  const candidates = forwardedTarget ? [requestTarget, forwardedTarget] : [requestTarget];

  for (const rule of RULES) {
    if (candidates.some((candidate) => rule.pattern.test(candidate))) return rule.id;
  }
  return null;
};

const safePathForLog = (req) =>
  String(req.path || '/')
    .slice(0, 256)
    .replace(/[\r\n\t]/g, '_');

const webApplicationFirewall = (req, res, next) => {
  res.setHeader('X-Bulka-WAF', 'active');
  const ruleId = inspectRequest(req);
  if (!ruleId) return next();

  console.warn(
    `[security:waf] blocked method=${String(req.method || 'GET')} path=${JSON.stringify(
      safePathForLog(req),
    )} rule=${ruleId}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  return res.status(403).json({ error: 'Request blocked', code: 'WAF_BLOCKED' });
};

module.exports = { inspectRequest, webApplicationFirewall };
