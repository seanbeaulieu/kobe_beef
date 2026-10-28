import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { generatePages, siteUrl, sitemapPaths } from './scripts/pages.mjs';

// Mirror the global block of public/_headers (Cloudflare Pages / Netlify format)
// in `vite preview`, so CSP problems show up locally before deploy.
function globalHeaders(): Record<string, string> {
  const lines = readFileSync('public/_headers', 'utf8').split(/\r?\n/);
  const out: Record<string, string> = {};
  let inGlobal = false;
  for (const line of lines) {
    if (!line.startsWith(' ') && line.trim()) inGlobal = line.trim() === '/*';
    else if (inGlobal && line.includes(':')) {
      const i = line.indexOf(':');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  delete out['Strict-Transport-Security'];
  // preview runs on plain-http localhost
  out['Content-Security-Policy'] = out['Content-Security-Policy']?.replace(/;\s*upgrade-insecure-requests/, '');
  return out;
}

// Static per-restaurant pages (see scripts/pages.mjs), built as extra Vite
// entries, plus robots.txt and, when SITE_URL is set, sitemap.xml.
function kobePages(): Plugin {
  return {
    name: 'kobe-pages',
    config(_, { command }) {
      const pages = generatePages();
      if (command !== 'build') return;
      const input: Record<string, string> = { main: 'index.html', 'real-kobe-beef': 'real-kobe-beef/index.html' };
      for (const file of pages) input[relative(process.cwd(), file).split(sep).join('/').replace(/\/index\.html$/, '')] = file;
      return { build: { rollupOptions: { input } } };
    },
    generateBundle() {
      const site = siteUrl();
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n${site ? `\nSitemap: ${site}/sitemap.xml\n` : ''}`,
      });
      if (!site) {
        this.warn('SITE_URL is not set: building without canonical links or sitemap.xml');
        return;
      }
      const urls = sitemapPaths().map((p: string) => `  <url><loc>${site}${p}</loc></url>`);
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [kobePages()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  preview: {
    headers: globalHeaders(),
  },
});
