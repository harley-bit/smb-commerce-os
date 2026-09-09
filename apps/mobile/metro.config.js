const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

// Metro has no `node:crypto` — see src/shims/nodeCrypto.ts for why the
// shared @smb-os/contracts/@smb-os/domain module graph needs one anyway.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "node:crypto": path.resolve(__dirname, "src/shims/nodeCrypto.ts"),
};

module.exports = config;
