# Module Load Hooks with Memfs for Dynamic Import Testing

## Overview

Vitest's module load hooks (`registerHooks`) can intercept ES module loads and serve content from an in-memory filesystem (memfs) instead of the real filesystem. This pattern enables testing of dynamic imports, configuration file loading, and hot-module-reload scenarios **without touching disk**.

## How It Works

When a Node.js `import()` or `import` statement is executed:

1. The registrar intercepts the `load` hook for that URL
2. The hook checks if the path exists in memfs's virtual `vol`
3. If found, it returns the content directly from `vol`—bypassing disk I/O
4. If not found, the hook delegates to the next handler in the chain

This allows tests to:
- Create virtual file structures in memory
- Test dynamic imports of generated/temporary files
- Verify module caching and reloading behavior
- Simulate configuration file discovery without real files

## Setup

The setup file is configured in `vitest.config.ts` as a `setupFile` for unit tests:

```ts
// vitest.config.ts
export default defineConfig(({ mode }) => ({
  projects: [
    {
      name: "unit",
      test: {
        setupFiles: ["vitest.external-module.setup.ts"],
        // ...
      },
    },
  ],
}));
```

The setup hook registers once per test session (idempotent) and then serves all subsequent module loads.

## Real-World Examples

### Example 1: Testing .decohere.js Config Loading

Forge CLI behavior: `projects/cli/tests/forge.integration.spec.ts`. Action/config edges the CLI cannot see live under `projects/forge/tests/`.

```ts
it("loads .decohere.js from custom --workspace-root in memfs", async () => {
  const workspaceRoot = path.dirname(forgeConfigFixturePath);
  
  // Populate memfs with a virtual .decohere.js file (no disk write)
  vol.fromJSON({
    [`${workspaceRoot}/.decohere.js`]: "export default { /* config */ };",
  });

  // Dynamic import(workspaceRoot + '/.decohere.js') now reads from memfs
  await runBuild("--workspace-root", workspaceRoot);
  
  expect(fileExists(`${workspaceRoot}/.custom-out/...`)).toBe(true);
});
```

The build process dynamically imports `.decohere.js` and receives the content from `vol`, not from disk.

### Example 2: Hot-Module-Reload Integration Tests

`projects/flux/tests/hmr.server.spec.ts`:

```ts
describe("HotReloadServer with memfs", () => {
  beforeEach(async () => {
    // Fixtures exist on disk so they can be externalized
    const realFs = await vi.importActual("node:fs");
    
    // Copy fixture contents into memfs virtual volume
    vol.fromJSON({
      [mainPath]: realFs.readFileSync(mainPath, "utf8"),
      [depAPath]: realFs.readFileSync(depAPath, "utf8"),
      [depBPath]: realFs.readFileSync(depBPath, "utf8"),
    });
    
    // HotReloadServer will now serve from memfs during test
    await server.start(mainPath, fixturesDir);
  });

  it("should invalidate dependent modules when a file changes", async () => {
    // vol.writeFileSync mutates the virtual module
    vol.writeFileSync(depAPath, `export const value = 42;`);
    
    // The load hook intercepts the next import and serves the new version
    const reboot = nextReboot(server);
    await reboot;
    
    expect(server.isRunning).toBe(true);
  });
});
```

## Key Patterns

### Fixture Seeding

Read fixtures from disk once, then write them to memfs:

```ts
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
vol.fromJSON({
  ["/fixture/path"]: realFs.readFileSync("/fixture/path", "utf8"),
});
```

**Why?** Vite's externalization needs the files to physically exist to resolve them. Once externalized, subsequent imports are intercepted by the load hook.

### Mocking fs

For tests that inspect the filesystem, mock `fs`:

```ts
vi.mock("fs");
vi.mock("node:fs");
```

This redirects all `fs.readFileSync()`, `fs.writeFileSync()`, etc. to the memfs `vol`.

### Cleanup

Always reset memfs after tests:

```ts
afterEach(() => {
  vol.reset();
});
```

## When to Use

✅ **Use module load hooks + memfs when:**
- Testing dynamic `import()` of config files
- Testing hot-reload/module invalidation behavior
- Testing generation of temporary modules in memory
- Avoiding disk I/O in integration tests
- Verifying module caching strategies

❌ **Don't use when:**
- Testing simple unit functions (use direct mocks instead)
- Testing only synchronous filesystem checks (mock `fs` is enough)
- The test doesn't involve dynamic imports or hot-reload

## Troubleshooting

### "Module not found" errors even though vol has the file

**Cause:** Vite inlined the module before it was registered in `vol`.

**Solution:** Ensure the file physically exists on disk before the test runs so Vite can externalize it. Then populate `vol` in the test.

### Load hook fires but returns wrong content

**Cause:** The hook is checking the wrong path, or the path format doesn't match between Vite's resolution and your memfs structure.

**Solution:** Debug with:
```ts
load: (url, context, next) => {
  const path = new URL(url).pathname;
  console.log("Intercepted load:", path, "exists:", vol.existsSync(path));
  // ...
}
```

### Tests pass in isolation but fail in parallel

**Cause:** `vol` state leaks between parallel tests.

**Solution:** Always `vol.reset()` in `afterEach`, or use `beforeEach` to reset before seeding.

## References

- [Vitest Module Load Hooks](https://vitest.dev/guide/environment.html#load-hooks)
- [Memfs Documentation](https://github.com/streamich/memfs)
- Related tests:
  - [HotReloadServer unit edges](../../../projects/flux/tests/hmr.server.spec.ts)
  - [Forge CLI integration](../../../projects/cli/tests/forge.integration.spec.ts)
