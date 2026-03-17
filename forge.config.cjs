const os = require("os");
const fs = require("fs");

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    asar: {
      // Unpack native modules so they can be loaded outside the asar
      unpack: "**/*.node",
      unpackDir: "{node_modules/better-sqlite3,node_modules/bindings,node_modules/file-uri-to-path}",
    },
    icon: "./icon",
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
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "AniTrack",
        authors: "nikm3r",
        description: "Anime tracking desktop app",
        setupIcon: "./icon.ico",
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
            format: "ULFO",
          },
        }]
      : []),
  ],
};

module.exports = config;
