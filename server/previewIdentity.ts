// Platform-provided identity only; no hostname/browser flag can enable this.
export const ISOLATED_STAGE3_PROJECT = 'prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW';
export function isolatedStage3Preview(env = process.env) {
  return (
    env.VERCEL === '1' &&
    env.VERCEL_ENV === 'preview' &&
    (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === 'preview') &&
    env.VERCEL_PROJECT_ID === ISOLATED_STAGE3_PROJECT
  );
}
