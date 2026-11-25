// Metro config. Needed for Expo web only: expo-sqlite runs SQLite as WebAssembly in a web
// worker, so Metro must serve .wasm files, and the page must be cross-origin isolated
// (COOP + COEP headers) for the worker's SharedArrayBuffer. Android and iOS are unaffected.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // "credentialless" (not "require-corp") so cross-origin calls to the API still work with CORS.
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;
