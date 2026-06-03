const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [repoRoot];

module.exports = config;
