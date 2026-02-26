#!/usr/bin/env node
/**
 * scrape.js — JS-rendered web scraper using Playwright
 *
 * Usage:
 *   node scripts/scrape.js <url> [options]
 *
 * Options:
 *   --links          Also extract all links
 *   --click <sel>    Click elements matching selector before scraping (e.g. "details summary")
 *   --wait <ms>      Extra wait after load (default: 2000)
 *   --out <file>     Write output to file instead of stdout
 *   --crawl          Follow same-origin links and scrape all pages
 *   --limit <n>      Max pages to crawl (default: 50)
 */

const pw = require('/Users/shantumgupta/Desktop/COH-ERP2/client/node_modules/playwright-core');

async function scrape(url, opts = {}) {
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(opts.wait || 2000);

    // Click expandable elements if requested
    if (opts.click) {
      const els = await page.$$(opts.click);
      for (const el of els) {
        try { await el.click(); } catch {}
      }
      await page.waitForTimeout(500);
    }

    // Extract text content
    const text = await page.evaluate(() => document.body.innerText);

    // Extract links if requested
    let links = [];
    if (opts.links || opts.crawl) {
      links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .map(a => ({ text: a.innerText.trim(), href: a.href }))
          .filter(l => l.href.startsWith('http'))
      );
    }

    return { url, text, links };
  } catch (err) {
    return { url, text: '', links: [], error: err.message };
  } finally {
    await page.close();
  }
}

async function crawl(startUrl, opts = {}) {
  const limit = opts.limit || 50;
  const origin = new URL(startUrl).origin;
  const visited = new Set();
  const queue = [startUrl];
  const results = [];

  const browser = await pw.chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  while (queue.length > 0 && results.length < limit) {
    const url = queue.shift();
    const normalized = url.split('#')[0].split('?')[0].replace(/\/$/, '');
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const page = await context.newPage();
    try {
      process.stderr.write(`[${results.length + 1}/${limit}] ${url}\n`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(opts.wait || 1500);

      if (opts.click) {
        const els = await page.$$(opts.click);
        for (const el of els) {
          try { await el.click(); } catch {}
        }
        await page.waitForTimeout(300);
      }

      const text = await page.evaluate(() => document.body.innerText);
      const title = await page.title();
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .map(a => a.href)
          .filter(h => h.startsWith('http'))
      );

      results.push({ url, title, text });

      // Queue same-origin links
      for (const link of links) {
        const clean = link.split('#')[0].split('?')[0].replace(/\/$/, '');
        if (clean.startsWith(origin) && !visited.has(clean)) {
          queue.push(link);
        }
      }
    } catch (err) {
      process.stderr.write(`  Error: ${err.message}\n`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return results;
}

// CLI
(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node scripts/scrape.js <url> [--links] [--click <sel>] [--wait <ms>] [--out <file>] [--crawl] [--limit <n>]');
    process.exit(0);
  }

  const url = args[0];
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--links') opts.links = true;
    if (args[i] === '--crawl') opts.crawl = true;
    if (args[i] === '--click') opts.click = args[++i];
    if (args[i] === '--wait') opts.wait = parseInt(args[++i]);
    if (args[i] === '--out') opts.out = args[++i];
    if (args[i] === '--limit') opts.limit = parseInt(args[++i]);
  }

  let output;

  if (opts.crawl) {
    const results = await crawl(url, opts);
    const separator = '\n\n' + '='.repeat(80) + '\n\n';
    output = results.map(r =>
      `# ${r.title}\nURL: ${r.url}\n\n${r.text}`
    ).join(separator);
    process.stderr.write(`\nDone: ${results.length} pages scraped\n`);
  } else {
    const result = await scrape(url, opts);
    if (result.error) {
      process.stderr.write(`Error: ${result.error}\n`);
    }
    output = result.text;
    if (opts.links && result.links.length > 0) {
      output += '\n\n--- LINKS ---\n';
      output += result.links.map(l => `${l.text} → ${l.href}`).join('\n');
    }
  }

  if (opts.out) {
    require('fs').writeFileSync(opts.out, output);
    process.stderr.write(`Written to ${opts.out}\n`);
  } else {
    console.log(output);
  }
})();
