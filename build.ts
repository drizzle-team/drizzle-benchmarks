import * as esbuild from "esbuild";

esbuild.buildSync({
  entryPoints: ["./src/drizzle-server.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "cjs",
  target: "node18",
  platform: "node",
  external: [
    "esbuild",
    "pg-native",
    "ramda"
  ],
});


