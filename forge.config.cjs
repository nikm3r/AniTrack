const os = require("os");
const fs = require("fs");

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    asar: {
      unpack: "**/*.node",
      unpackDir: "{node_modules/better-sqlite3,node_modules/bindings,node_modules/file-uri-to-path}",
    },
    icon: "./icon",
    extraResource: ["./resources/syncplay.lua", "./icon.png"],
    ignore: [
      /^\/src/,
      /^\/server/,
      /^\/\.github/,
      /^\/node_modules\/.cache/,
      /tsconfig\.json$/,
      /vite\.config\.ts$/,
      /esbuild\.config\.js$/,
    ],
  },
  rebuildConfig: {},
  plugins: [],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: { owner: "nikm3r", name: "AniTrack" },
        prerelease: false,
        draft: false,
      },
    },
  ],
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "AniTrack",
        authors: "nikm3r",
        description: "Anime tracking desktop app",
        setupIcon: "./icon.ico",
        exe: "AniTrack.exe",
        title: "AniTrack",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["linux", "win32", "darwin"],
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "anitrack",
          productName: "AniTrack",
          description: "Anime tracking desktop app",
          maintainer: "nikm3r",
          homepage: "https://github.com/nikm3r/AniTrack",
          icon: "./icon.png",
          categories: ["Utility"],
          license: "MIT",
        },
      },
    },
    ...(os.platform() === "linux" && fs.existsSync("/var/lib/rpm")
      ? [{
          name: "@electron-forge/maker-rpm",
          platforms: ["linux"],
          config: {
            options: {
              name: "anitrack",
              productName: "AniTrack",
              description: "Anime tracking desktop app",
              homepage: "https://github.com/nikm3r/AniTrack",
              icon: "./icon.png",
              categories: ["Utility"],
              license: "MIT",
            },
          },
        }]
      : []),
    ...(os.platform() === "darwin"
      ? [{
          name: "@electron-forge/maker-dmg",
          platforms: ["darwin"],
          config: {
            name: "AniTrack",
            icon: "./icon.icns",
            overwrite: true,
            format: "UDZO",  // ULFO causes hdiutil detach failures on GitHub Actions
          },
        }]
      : []),
  ],
};

module.exports = config;
