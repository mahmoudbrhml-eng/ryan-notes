import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The text-PDF engine ships a headless Chromium for the serverless function:
  // both must stay outside the bundler (native binaries + dynamic requires).
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  // Files the /api/pdf-build route reads from disk at runtime: fonts for the
  // PDF renderer, the vendored Paged.js build, and the compressed Chromium
  // binary of @sparticuz/chromium (its dynamic __dirname reads are not traced).
  outputFileTracingIncludes: {
    '/api/pdf-build': [
      './lib/vendor/paged.esm.js',
      './assets/fonts/**',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
  },
}

export default nextConfig
