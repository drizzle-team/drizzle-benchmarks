import * as esbuild from "esbuild";

esbuild.buildSync({
  entryPoints: ["./src/drizzle-server-node.ts"],
  bundle: true,
  minify: true,
  outfile: "dist/drizzle.js",
  format: "cjs",
  target: "node22",
  platform: "node",
  external: [
    "esbuild",
    "pg-native",
  ],
});

esbuild.buildSync({
  entryPoints: ["./src/prisma-server-node.ts"],
  bundle: true,
  minify: true,
  outfile: "dist/prisma.js",
  format: "cjs",
  target: "node22",
  platform: "node",
  external: [
    "esbuild",
    "pg-native",
  ],
});


esbuild.buildSync({
  entryPoints: ["./src/prisma-joins-server-node.ts"],
  bundle: true,
  minify: true,
  outfile: "dist/prisma-joins.js",
  format: "cjs",
  target: "node22",
  platform: "node",
  external: [
    "esbuild",
    "pg-native",
  ],
});