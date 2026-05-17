// Post-export step: inject PWA manifest link + iOS home-screen meta tags
// into dist/index.html.
//
// Expo SDK 54's Metro web bundler doesn't auto-generate these. Without
// them, "Add to Home Screen" on iOS produces a generic icon and opens
// the app inside Safari's chrome instead of full-screen.
//
// Run from app/frontend/ as part of deploy-web.sh.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexPath = resolve('dist/index.html');

const tags = `    <link rel="manifest" href="/manifest.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Club 32">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
`;

let html = readFileSync(indexPath, 'utf8');

if (html.includes('rel="manifest"')) {
  console.log('patch-html: tags already present, no changes');
  process.exit(0);
}

const updated = html.replace('</head>', `${tags}  </head>`);

if (updated === html) {
  console.error('patch-html: ERROR could not find </head> in dist/index.html');
  process.exit(1);
}

writeFileSync(indexPath, updated);
console.log('patch-html: added PWA manifest + iOS home-screen meta tags');
