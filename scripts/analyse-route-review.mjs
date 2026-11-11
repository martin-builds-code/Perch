// Codex consumes the uploaded file(s); the owner never runs this script.
// Offline only: no provider, analytics, storage service or HTTP requests.
import { readFile, writeFile } from 'node:fs/promises';
import { routeReviewCases } from '../server/routeReviewCases.ts';
import { analyseReview } from '../src/routeReviewAnalysis.ts';
const files = await Promise.all(
  process.argv.slice(2).map(async (path) => {
    const data = await readFile(path);
    if (data.byteLength > 524288)
      throw Error('Review file exceeds 512 KiB');
    return JSON.parse(data.toString());
  }),
);
const result = analyseReview(routeReviewCases, files);
if (process.env.PERCH_REVIEW_SUMMARY)
  await writeFile(
    process.env.PERCH_REVIEW_SUMMARY,
    JSON.stringify(result, null, 2) + '\n',
  );
console.log(JSON.stringify(result, null, 2));
if (result.conflicts.length) process.exitCode = 2;
