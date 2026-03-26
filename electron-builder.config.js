/** @type {import('electron-builder').Configuration} */
const config = {
  appId: "com.nikm.anitrack",
  productName: "AniTrack",
  copyright: "Copyright © 2025 nikm3r",

  files: [
    "renderer/**/*",
    "dist-server/**/*",
    "main.js",
    "preload.js",
    "package.json",
  ],

  extraResources: [
    { from: "resources/syncplay.lua", to: "syncplay.lua" },
    { from: "icon.png",               to: "icon.png"    },
  ],

  asar: true,
  asarUnpack: [
    "node_modules/better-sqlite3/**/*",
    "node_modules/bindings/**/*",
    "node_modules/file-uri-to-path/**/*",
  ],

  linux: {
    icon: "icon.png",
    category: "AudioVideo",
    executableName: "anitrack",
    executableArgs: ["--no-sandbox"],
    desktop: {
      Exec: "anitrack --no-sandbox %U",
    },
  },
  deb: {
    packageName: "anitrack",
    maintainer: "nikm3r <nmermigkas@gmail.com>",
    homepage: "https://github.com/nikm3r/AniTrack",
  },

  win: {
    icon: "icon.png",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: "AniTrack",
    installerIcon: "icon.png",
    uninstallerIcon: "icon.png",
  },

  mac: {
    icon: "icon.icns",
  },
  dmg: {
    title: "AniTrack",
    overwrite: true,
  },
};

module.exports = config;
