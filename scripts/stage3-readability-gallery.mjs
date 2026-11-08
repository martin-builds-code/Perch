// Export side-by-side review sheets from existing screenshots; no artwork editing.
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: process.env.PERCH_CHROMIUM ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 2096, height: 1000 },
  });
  await page.goto('http://127.0.0.1:5173/docs/stage3-readability/gallery.html');
  await page.evaluate(() =>
    Promise.all([...document.images].map((i) => i.decode())),
  );
  for (const mode of ['multiple', 'single'])
    for (const height of [768, 624])
      await page
        .locator(`#${mode}-${height}`)
        .screenshot({
          path: `docs/stage3-readability/comparison-${mode}-1024x${height}.png`,
        });
  console.log('PASS: four before/after review sheets exported.');
} finally {
  await browser.close();
}
