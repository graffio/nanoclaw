/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

// If the upstream goes this long without sending any bytes, treat it as stalled
// and tear the connection down. Claude streaming responses emit events frequently
// (well under a minute between chunks), so 2 minutes of total silence is anomalous.
// Without this, a stalled /v1/messages response pins the container until the
// 30-min hard task timeout fires with no output and no error.
const UPSTREAM_IDLE_TIMEOUT_MS = 120_000;

// Ring buffer of recent upstream errors. Used to annotate "API Error: …"
// messages that the Claude Agent SDK surfaces when its retries exhaust, so
// the user can tell upstream flakiness from other failures.
export interface UpstreamErrorEntry {
  ts: number;
  code: string;
  url: string;
  phase: 'pre-header' | 'mid-stream' | 'idle-timeout';
}
const UPSTREAM_ERROR_RETENTION_MS = 300_000;
const upstreamErrorLog: UpstreamErrorEntry[] = [];

function recordUpstreamError(entry: Omit<UpstreamErrorEntry, 'ts'>): void {
  const now = Date.now();
  upstreamErrorLog.push({ ...entry, ts: now });
  const cutoff = now - UPSTREAM_ERROR_RETENTION_MS;
  while (upstreamErrorLog.length > 0 && upstreamErrorLog[0].ts < cutoff) {
    upstreamErrorLog.shift();
  }
}

export function getRecentUpstreamErrors(
  windowMs: number = UPSTREAM_ERROR_RETENTION_MS,
): UpstreamErrorEntry[] {
  const cutoff = Date.now() - windowMs;
  return upstreamErrorLog.filter((e) => e.ts >= cutoff);
}

/** @internal - for tests */
export function _clearUpstreamErrorLog(): void {
  upstreamErrorLog.length = 0;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: req.url,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
            // Propagate mid-stream upstream failures to the client so the
            // SDK sees a socket error instead of waiting forever.
            upRes.on('error', (err) => {
              logger.error(
                { err, url: req.url },
                'Credential proxy upstream response error',
              );
              recordUpstreamError({
                code:
                  (err as NodeJS.ErrnoException).code || err.message || 'ERROR',
                url: req.url || '',
                phase: 'mid-stream',
              });
              res.destroy(err);
            });
          },
        );

        // Idle-timeout the upstream request: if no bytes flow for this long,
        // destroy the socket so the SDK sees a connection failure.
        upstream.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => {
          logger.error(
            { url: req.url, timeoutMs: UPSTREAM_IDLE_TIMEOUT_MS },
            'Credential proxy upstream idle timeout',
          );
          recordUpstreamError({
            code: 'IDLE_TIMEOUT',
            url: req.url || '',
            phase: 'idle-timeout',
          });
          upstream.destroy(new Error('upstream idle timeout'));
        });

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          recordUpstreamError({
            code:
              (err as NodeJS.ErrnoException).code || err.message || 'ERROR',
            url: req.url || '',
            phase: res.headersSent ? 'mid-stream' : 'pre-header',
          });
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          } else {
            // Headers already sent means we're mid-stream. Destroying the
            // client response surfaces the failure to the SDK.
            res.destroy(err);
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
