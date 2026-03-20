/**
 * Outbound API proxy for container agents.
 *
 * Sits between container agents and external services. Agents hit this
 * proxy without credentials; the proxy injects the appropriate auth
 * and only forwards requests matching a strict allowlist.
 *
 * Supported services:
 *   - HomeExchange: bearer token (auto-login from .env)
 *   - Substack: session cookies (loaded from credentials file)
 *
 * Credentials:
 *   HomeExchange: HOMEEXCHANGE_EMAIL + HOMEEXCHANGE_PASSWORD in .env
 *   Substack: groups/global/knowledge-base/stephen-tobin/credentials/substack-cookies.json
 *             or groups/telegram_main/credentials/substack-cookies.json
 */
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { request as httpsRequest, RequestOptions } from 'https';
import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

// --- Endpoint allowlist (read-only operations only) ---

type CredentialType = 'homeexchange' | 'substack';

interface AllowedRoute {
  method: string;
  pattern: RegExp;
  upstream: string; // base URL for this route
  credentialType: CredentialType;
}

const ALLOWED_ROUTES: AllowedRoute[] = [
  // === HomeExchange ===
  {
    method: 'POST',
    pattern: /^\/search\/homes\b/,
    upstream: 'https://bff.homeexchange.com',
    credentialType: 'homeexchange',
  },
  {
    method: 'POST',
    pattern: /^\/api\/homes\/search\b/,
    upstream: 'https://www.homeexchange.com',
    credentialType: 'homeexchange',
  },
  {
    method: 'GET',
    pattern: /^\/v1\/homes\/\d+$/,
    upstream: 'https://api.homeexchange.com',
    credentialType: 'homeexchange',
  },
  {
    method: 'GET',
    pattern: /^\/v1\/homes\/\d+\/calendar$/,
    upstream: 'https://api.homeexchange.com',
    credentialType: 'homeexchange',
  },
  {
    method: 'GET',
    pattern: /^\/v1\/users\/\d+\/alerts$/,
    upstream: 'https://api.homeexchange.com',
    credentialType: 'homeexchange',
  },
  {
    method: 'GET',
    pattern: /^\/v1\/users\/\d+$/,
    upstream: 'https://api.homeexchange.com',
    credentialType: 'homeexchange',
  },
  {
    method: 'GET',
    pattern: /^\/v1\/homes\/\d+\/reviews$/,
    upstream: 'https://api.homeexchange.com',
    credentialType: 'homeexchange',
  },

  // === Substack (Stephen Tobin / Strategic Wave Trading) ===
  // Archive listing (paginated post list)
  {
    method: 'GET',
    pattern: /^\/api\/v1\/archive\b/,
    upstream: 'https://stephentobin.substack.com',
    credentialType: 'substack',
  },
  // Single post (full body)
  {
    method: 'GET',
    pattern: /^\/api\/v1\/posts\/[\w-]+$/,
    upstream: 'https://stephentobin.substack.com',
    credentialType: 'substack',
  },
  // Notes feed (Stephen's profile, user_id=39434881)
  {
    method: 'GET',
    pattern: /^\/api\/v1\/reader\/feed\/profile\/39434881\b/,
    upstream: 'https://substack.com',
    credentialType: 'substack',
  },
  // Chat threads listing (publication_id=1592835)
  {
    method: 'GET',
    pattern: /^\/api\/v1\/community\/publications\/1592835\/posts\b/,
    upstream: 'https://substack.com',
    credentialType: 'substack',
  },
  // Chat thread replies
  {
    method: 'GET',
    pattern: /^\/api\/v1\/community\/posts\/[\w-]+\/comments\b/,
    upstream: 'https://substack.com',
    credentialType: 'substack',
  },
  // Post comments (for author comments)
  {
    method: 'GET',
    pattern: /^\/api\/v1\/post\/\d+\/comments\b/,
    upstream: 'https://stephentobin.substack.com',
    credentialType: 'substack',
  },
];

function matchRoute(method: string, path: string): AllowedRoute | null {
  for (const route of ALLOWED_ROUTES) {
    if (route.method === method && route.pattern.test(path)) {
      return route;
    }
  }
  return null;
}

// --- Auth: HomeExchange ---

let bearer: string | null = null;
let authInProgress: Promise<string> | null = null;

async function authenticate(): Promise<string> {
  if (authInProgress) return authInProgress;
  authInProgress = doAuthenticate().finally(() => {
    authInProgress = null;
  });
  return authInProgress;
}

async function doAuthenticate(): Promise<string> {
  const secrets = readEnvFile(['HOMEEXCHANGE_EMAIL', 'HOMEEXCHANGE_PASSWORD']);
  const email = secrets.HOMEEXCHANGE_EMAIL;
  const password = secrets.HOMEEXCHANGE_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'HomeExchange credentials not configured. Set HOMEEXCHANGE_EMAIL and HOMEEXCHANGE_PASSWORD in .env',
    );
  }

  logger.info('Outbound proxy: HomeExchange authenticating...');

  const response = await fetch('https://www.homeexchange.com/dashboard', {
    headers: {
      cookie: `email=${email}; password=${password}`,
    },
    redirect: 'follow',
  });

  const body = await response.text();
  const match = body.match(/accessToken:\s*"([^"]*)"/);
  if (!match) {
    throw new Error(
      'Failed to extract accessToken from HomeExchange dashboard. Login flow may have changed.',
    );
  }

  const token = `Bearer ${match[1]}`;
  bearer = token;
  logger.info('Outbound proxy: HomeExchange authenticated');
  return token;
}

// --- Auth: Substack ---

let substackCookies: string | null = null;

function loadSubstackCookies(): string | null {
  const projectRoot = process.cwd();
  const credPaths = [
    path.join(
      projectRoot,
      'groups/global/knowledge-base/stephen-tobin/credentials/substack-cookies.json',
    ),
    path.join(
      projectRoot,
      'groups/telegram_main/credentials/substack-cookies.json',
    ),
  ];

  for (const p of credPaths) {
    if (fs.existsSync(p)) {
      try {
        const creds = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const sid = creds['substack.sid'];
        const lli = creds['substack.lli'];
        if (sid) {
          return `substack.sid=${sid}; substack.lli=${lli || ''}`;
        }
      } catch {
        // skip malformed file
      }
    }
  }
  return null;
}

// --- Proxy ---

function buildHeaders(
  route: AllowedRoute,
  body: Buffer,
  req: IncomingMessage,
): Record<string, string | number> | null {
  const upstreamUrl = new URL(route.upstream);

  if (route.credentialType === 'homeexchange') {
    if (!bearer) return null;
    const headers: Record<string, string | number> = {
      host: upstreamUrl.host,
      accept: 'application/json',
      authorization: bearer,
      'content-length': body.length,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      origin: 'https://www.homeexchange.com',
      referer: 'https://www.homeexchange.com/',
      'x-search-api-version': 'v2',
      'x-legacy-response': 'false',
    };
    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'] as string;
    }
    return headers;
  }

  if (route.credentialType === 'substack') {
    // Reload cookies on each request (may be refreshed on disk)
    substackCookies = loadSubstackCookies() || substackCookies;
    if (!substackCookies) return null;
    return {
      host: upstreamUrl.host,
      accept: 'application/json',
      cookie: substackCookies,
      'content-length': body.length,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) NanoClaw/1.0',
    };
  }

  return null;
}

function forwardRequest(
  route: AllowedRoute,
  req: IncomingMessage,
  body: Buffer,
  res: ServerResponse,
  isRetry = false,
): void {
  const upstreamUrl = new URL(route.upstream);

  const headers = buildHeaders(route, body, req);
  if (!headers) {
    res.writeHead(502);
    res.end(
      JSON.stringify({
        error: `No credentials available for ${route.credentialType}`,
      }),
    );
    return;
  }

  if (req.headers['content-type']) {
    headers['content-type'] = req.headers['content-type'] as string;
  }

  const options: RequestOptions = {
    hostname: upstreamUrl.hostname,
    port: 443,
    path: req.url,
    method: req.method,
    headers,
  };

  const upstream = httpsRequest(options, (upRes) => {
    // On 401 for HomeExchange, try re-auth once
    if (
      upRes.statusCode === 401 &&
      !isRetry &&
      route.credentialType === 'homeexchange'
    ) {
      upRes.resume();
      logger.info('Outbound proxy: HomeExchange 401, re-authenticating...');
      authenticate()
        .then(() => {
          forwardRequest(route, req, body, res, true);
        })
        .catch((err) => {
          logger.error({ err }, 'Outbound proxy: re-auth failed');
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Authentication failed' }));
        });
      return;
    }

    res.writeHead(upRes.statusCode!, upRes.headers);
    upRes.pipe(res);
  });

  upstream.on('error', (err) => {
    logger.error({ err, url: req.url }, 'Outbound proxy upstream error');
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Bad Gateway' }));
    }
  });

  upstream.write(body);
  upstream.end();
}

export function startHomeExchangeProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const route = matchRoute(req.method || 'GET', req.url || '/');

      if (!route) {
        logger.warn(
          { method: req.method, url: req.url },
          'Outbound proxy: blocked request (not in allowlist)',
        );
        res.writeHead(403);
        res.end(
          JSON.stringify({
            error: 'Forbidden',
            message: `${req.method} ${req.url} is not allowed. This proxy only permits read operations.`,
          }),
        );
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        // HomeExchange needs a bearer token; Substack uses cookies (always ready)
        if (route.credentialType === 'homeexchange' && !bearer) {
          authenticate()
            .then(() => forwardRequest(route, req, body, res))
            .catch((err) => {
              logger.error({ err }, 'Outbound proxy: HomeExchange auth failed');
              res.writeHead(502);
              res.end(JSON.stringify({ error: 'Authentication failed' }));
            });
        } else {
          forwardRequest(route, req, body, res);
        }
      });
    });

    server.listen(port, host, () => {
      // Pre-load Substack cookies
      substackCookies = loadSubstackCookies();
      if (substackCookies) {
        logger.info('Outbound proxy: Substack cookies loaded');
      }
      logger.info({ port, host }, 'Outbound API proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}
