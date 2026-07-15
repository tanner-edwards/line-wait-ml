module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 54) automatically includes the
    // react-native-worklets babel plugin when react-native-reanimated is
    // installed. Having this config file present ensures the preset runs with
    // app/frontend as the project root, so its reanimated auto-detection
    // resolves correctly (the repo-root watchFolder in metro.config.js was
    // throwing that detection off when no babel.config.js existed).
    presets: ['babel-preset-expo'],
  };
};
