// purposefully left blank because load the actual contents of this file using the
// tests/external-module.setup.ts. That script loads a module hook that looks for files
// in memfs and loads them as test fixtures. This allows us to define in memory test fixture
// files that work with dynamic import() - which we use use to load .decohere.js

// For the vitest external module loader to work during unit tests,
// the path of the file that is imported using dynamic import
// hos to match the actual test fixture file. We then intercept that import
// and load the file configured in memfs.

// so in vitest.config.ts, we configure this file to be an external
// in tests/external-module.setup.ts - we import that from the current memfs vol
// in a unit test, we load tht exact file into memfs vol - see workspace.factory.spec.ts for example
