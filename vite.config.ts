import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

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

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  preview: {
    headers: globalHeaders(),
  },
});
