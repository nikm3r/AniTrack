const os = require("os");

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    asar: true,
    icon: "./icon",
    extraResource: [
      "./dist-server",
      "./node_modules/better-sqlite3",
    ],
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
      config: { name: "AniTrack", setupIcon: "./icon.ico" },
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
          homepage: "https://github.com/nikm3r/anitrack",
          icon: "./icon.png",
          categories: ["Utility"],
          license: "MIT",
        },
      },
    },
    ...(os.platform() === "linux" && require("fs").existsSync("/var/lib/rpm")
      ? [{
          name: "@electron-forge/maker-rpm",
          platforms: ["linux"],
          config: {
            options: {
              name: "anitrack",
              productName: "AniTrack",
              description: "Anime tracking desktop app",
              homepage: "https://github.com/nikm3r/anitrack",
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
