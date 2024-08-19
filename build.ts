import * as esbuild from "esbuild";

esbuild.buildSync({
  entryPoints: ["./src/drizzle-server-node.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "cjs",
  target: "node22",
  platform: "node",
  external: [
    "esbuild",
    "pg-native",
  ],
});


