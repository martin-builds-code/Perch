import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { r05TestAccess } from '../server/r05TestAccess';
import { R05_BRANCH, R05_PROJECT } from '../server/adaptiveCoordinator';
import { adaptiveObservationUntil } from '../src/adaptiveBudget';
const T = 1_800_000_000_000,
  key = 'a'.repeat(64);
const env = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_PROJECT_ID: R05_PROJECT,
  VERCEL_GIT_COMMIT_REF: R05_BRANCH,
  AERO_R05_ENABLED: 'true',
  AERO_R05_TEST_KEY: key,
  AERO_R05_TEST_WINDOW: JSON.stringify({
    startedAtMs: T,
    expiresAtMs: T + 5400000,
  }),
};
const request = {
  method: 'GET',
  url: '/api/r05-observe?resource=session',
  headers: { 'x-aero-r05-test': key },
} as unknown as IncomingMessage;
test('R05 machine access is a bounded principal on one separate endpoint', () => {
  assert.deepEqual(r05TestAccess(request, env, T), {
    expiresAtMs: T + 5400000,
  });
  for (const at of [T - 1, T + 5400000, NaN, Infinity])
    assert.equal(r05TestAccess(request, env, at), null);
  for (const change of [
    { VERCEL_ENV: 'production' },
    { VERCEL_PROJECT_ID: 'other' },
    { VERCEL_GIT_COMMIT_REF: 'stage-3a-display-redesign' },
    { AERO_R05_ENABLED: 'false' },
    { VERCEL_TARGET_ENV: 'production' },
    { AERO_R05_TEST_KEY: '' },
    {
      AERO_R05_TEST_WINDOW: JSON.stringify({
        startedAtMs: T,
        expiresAtMs: T + 5400001,
      }),
    },
  ])
    assert.equal(r05TestAccess(request, { ...env, ...change }, T), null);
});
test('the credential cannot authorise normal PIN endpoints, POST or missing/wrong headers', () => {
  for (const url of [
    '/api/session',
    '/api/aircraft',
    '/api/enrichment?kind=route',
    '/api/route-review',
  ])
    assert.equal(
      r05TestAccess({ ...request, url } as IncomingMessage, env, T),
      null,
    );
  assert.equal(
    r05TestAccess(
      { ...request, method: 'POST' } as IncomingMessage,
      env,
      T,
    ),
    null,
  );
  for (const headers of [
    {},
    { 'x-aero-r05-test': 'b'.repeat(64) },
    { 'x-aero-r05-test': [key, key] },
    { 'x-aero-r05-test': key + ',' + key },
  ])
    assert.equal(
      r05TestAccess({ ...request, headers } as IncomingMessage, env, T),
      null,
    );
});
test('PIN-protected observation collection cannot request more than 90 minutes', () => {
  assert.equal(adaptiveObservationUntil('?observe=60', T), T + 3600000);
  assert.equal(adaptiveObservationUntil('?observe=90', T), T + 5400000);
  for (const query of [
    '',
    '?observe=91',
    '?observe=0',
    '?observe=NaN',
    '?observe=-1',
  ])
    assert.equal(adaptiveObservationUntil(query, T), undefined);
});
