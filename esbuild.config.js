const esbuild = require("esbuild");
const path = require("path");

esbuild
  .build({
    entryPoints: [path.join(__dirname, "server", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: path.join(__dirname, "dist-server", "index.js"),
    external: [
      // Native modules must stay external
      "better-sqlite3",
      "electron",
    ],
    sourcemap: process.env.NODE_ENV !== "production",
    minify: process.env.NODE_ENV === "production",
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV || "production"
      ),
    },
  })
  .then(() => {
    console.log("✅  Server compiled to dist-server/index.js");
  })
  .catch((err) => {
    console.error("❌  Server compilation failed:", err);
    process.exit(1);
  });
