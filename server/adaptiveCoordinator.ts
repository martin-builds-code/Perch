import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import {
  advanceAdaptiveState,
  ADAPTIVE_POLICY,
  validAdaptiveState,
} from '../src/adaptiveBudget.js';
import type { AdaptiveState } from '../src/adaptiveBudget.js';
import type { EnrichmentResult } from '../src/enrichmentTypes.js';

export interface CoordinatorRead {
  revision: number;
  state: AdaptiveState;
  nowMs: number;
  cache: { payload: string; expiresAtMs: number } | null;
}
export interface Coordinator {
  read: (key: string) => Promise<CoordinatorRead>;
  swap: (
    key: string,
    before: CoordinatorRead,
    state: AdaptiveState,
    cache?: EnrichmentResult,
  ) => Promise<boolean>;
  cacheValue: (row: CoordinatorRead) => EnrichmentResult | null;
  key: (value: string) => string;
}
export const R05_PROJECT = 'prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW';
export const R05_BRANCH = 'r05-adaptive-enrichment';
export function adaptiveEnabled(env = process.env) {
  return (
    env.AERO_R05_ENABLED === 'true' &&
    env.VERCEL === '1' &&
    env.VERCEL_ENV === 'preview' &&
    (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === 'preview') &&
    env.VERCEL_PROJECT_ID === R05_PROJECT &&
    (env.VERCEL_GIT_COMMIT_REF ?? env.AERO_R05_SOURCE_BRANCH) ===
      R05_BRANCH
  );
}
// Only this exact isolated Preview may opt in. A requested but misconfigured
// coordinator never falls back to the old process-local request path.
export function createCoordinator(
  env = process.env,
  fetcher: typeof fetch = fetch,
): Coordinator {
  const endpoint = env.AERO_R05_COORDINATOR_URL,
    apiKey = env.AERO_R05_COORDINATOR_API_KEY,
    secret = env.AERO_R05_COORDINATOR_SECRET;
  const dailyLimit = Number(
    env.AERO_R05_DAILY_LIMIT ?? ADAPTIVE_POLICY.dailyLimit,
  );
  if (
    !endpoint ||
    endpoint !== 'https://jjtkwqscfukioutgnxgc.supabase.co' ||
    !apiKey ||
    !secret ||
    !/^[a-f0-9]{64}$/.test(secret) ||
    !Number.isSafeInteger(dailyLimit) ||
    dailyLimit < 1 ||
    dailyLimit > 2880
  )
    throw Error('coordinator-configuration');
  const encryptionKey = createHash('sha256')
    .update(secret + ':cache')
    .digest();
  function seal(result: EnrichmentResult) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    const plain = Buffer.from(JSON.stringify(result));
    if (plain.length > 4096) throw Error('coordinator-cache-size');
    return Buffer.concat([
      iv,
      cipher.update(plain),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
  }
  async function exchange(
    key: string,
    before?: CoordinatorRead,
    state?: AdaptiveState,
    cache?: EnrichmentResult,
  ) {
    const controller = new AbortController(),
      timer = setTimeout(
        () => controller.abort(),
        ADAPTIVE_POLICY.rpcTimeoutMs,
      );
    try {
      const response = await fetcher(
        endpoint + '/rest/v1/rpc/perch_r05_exchange',
        {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', apikey: apiKey! },
          body: JSON.stringify({
            p_secret: secret,
            p_scope: 'live',
            p_key: key,
            ...(before
              ? { p_expected: before.revision, p_state: state }
              : {}),
            ...(cache
              ? { p_payload: seal(cache), p_expires: cache.expiresAtMs }
              : {}),
          }),
        },
      );
      if (
        !response.ok ||
        Number(response.headers.get('content-length')) > 131072
      )
        throw Error('coordinator-unavailable');
      if (!response.body) throw Error('coordinator-response');
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 131072) {
            controller.abort();
            throw Error('coordinator-size');
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks),
      );
      const v = JSON.parse(text) as Record<string, unknown>;
      if (v.ok === false && v.conflict === true) return null;
      if (
        v.ok !== true ||
        !Number.isSafeInteger(v.revision) ||
        !Number.isSafeInteger(v.nowMs) ||
        !validAdaptiveState(v.state) ||
        v.state.dailyLimit !== dailyLimit
      )
        throw Error('coordinator-response');
      // Validates authoritative monotonic DB time, never the instance's clock.
      advanceAdaptiveState(v.state, v.nowMs as number);
      return v as unknown as CoordinatorRead;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  return {
    key: (value) =>
      createHmac('sha256', secret).update(value).digest('hex'),
    read: async (key) => {
      const r = await exchange(key);
      if (!r) throw Error('coordinator-read');
      return r;
    },
    swap: async (key, before, state, cache) =>
      !!(await exchange(key, before, state, cache)),
    cacheValue: (row) => {
      try {
        if (!row.cache || row.cache.expiresAtMs <= row.nowMs) return null;
        const bytes = Buffer.from(row.cache.payload, 'base64');
        if (bytes.length < 28 || bytes.length > 8192) return null;
        const cipher = createDecipheriv(
          'aes-256-gcm',
          encryptionKey,
          bytes.subarray(0, 12),
        );
        cipher.setAuthTag(bytes.subarray(-16));
        return JSON.parse(
          Buffer.concat([
            cipher.update(bytes.subarray(12, -16)),
            cipher.final(),
          ]).toString('utf8'),
        ) as EnrichmentResult;
      } catch {
        return null;
      }
    },
  };
}
