/** @type {import('electron-builder').Configuration} */
const config = {
  appId: "com.nikm3r.anitrack",
  productName: "AniTrack",
  copyright: "Copyright © 2025 nikm3r",

  files: [
    "dist/**/*",
    "dist-server/**/*",
    "main.js",
    "preload.js",
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

  publish: {
    provider: "github",
    owner: "nikm3r",
    repo: "AniTrack",
    releaseType: "release",
  },

  // Linux — no snap, snapcraft not available on CI
  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb",      arch: ["x64"] },
      { target: "zip",      arch: ["x64"] },
    ],
    icon: "icon.png",
    category: "AudioVideo",
    executableName: "anitrack",
    artifactName: "${name}-linux-x64-${version}.${ext}",
  },
  deb: {
    packageName: "anitrack",
    maintainer: "nikm3r <nmermigkas@gmail.com>",
    homepage: "https://github.com/nikm3r/AniTrack",
  },

  // Windows — use PNG, electron-builder converts it automatically
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "zip",  arch: ["x64"] },
    ],
    icon: "icon.png",
    artifactName: "${name}-windows-x64-${version}.${ext}",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: "AniTrack",
  },

  // macOS
  mac: {
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
    icon: "icon.icns",
    artifactName: "${name}-mac-${arch}-${version}.${ext}",
  },
  dmg: {
    title: "AniTrack",
    overwrite: true,
  },
};

module.exports = config;
