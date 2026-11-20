// Elysia 1.4 (`elysia`) and Elysia 2.0 (`elysia2`, 2.0.0-rc.4) declare exact-mirror as a peer with ranges no
// single version satisfies (< 1 and >= 1.2.7), so pnpm leaves one of them without it. Here each Elysia gets
// its own exact-mirror (and Elysia 2 its typebox) as a plain dependency instead of the shared peer.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name !== 'elysia') return pkg;
      const v1 = pkg.version.startsWith('1.');
      const own = v1 ? { 'exact-mirror': '0.2.9' } : { 'exact-mirror': '1.2.7', typebox: '1.4.7' };
      for (const name of Object.keys(own)) delete pkg.peerDependencies?.[name];
      pkg.dependencies = { ...pkg.dependencies, ...own };
      return pkg;
    },
  },
};
