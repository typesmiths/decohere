# Testing Environment Variables with Decorators

## Problem

When testing TypeScript decorators that depend on environment variables (like `process.env.TEST`), the decorator is evaluated at import time, not at test runtime. This means that changing environment variables in test setup/teardown does not affect the decorator behavior since the module has already been imported and cached.

## Example Issue

```typescript
// This doesn't work as expected:
describe("cache decorator", () => {
  it("should disable caching when TEST=true", () => {
    process.env.TEST = "true"; // Too late - decorator already evaluated
    
    class TestClass {
      @cache() // This was evaluated when the test file was imported
      method() { return "test"; }
    }
    // Test will fail because caching is still enabled
  });
});
```

## Solution: Dynamic Imports with File URL Cache Busting

The solution is to use dynamic imports with versioned file URLs to force fresh module evaluation for each test scenario.

### Implementation

1. **Extract Test Classes**: Move test classes to separate files that can be dynamically imported
2. **File URL Helper**: Create a helper function that generates unique URLs for each import
3. **Dynamic Import**: Use `await import()` with versioned URLs in each test

### Code Example

```typescript
// Helper function to create versioned import URLs
function getImportUrl(filename: string): string {
  const modulePath = path.resolve(__dirname, filename);
  const moduleUrl = pathToFileUrl(modulePath);
  return `${moduleUrl}?version=${Date.now()}`; // Timestamp ensures uniqueness
}

// Test implementation
it("should disable caching when TEST=true", async () => {
  process.env.TEST = "true";
  
  // Dynamic import with cache busting URL
  const { CacheTestClass } = await import(getImportUrl("./cache-test-class.js"));
  const instance = new CacheTestClass();
  
  // Now the decorator sees TEST=true and disables caching
  const result1 = instance.method();
  const result2 = instance.method();
  expect(instance.callCount).toBe(2); // Called twice, not cached
});
```

### Key Benefits

- **Fresh Evaluation**: Each test gets a freshly evaluated module with current environment variables
- **Reliable Testing**: Environment variable changes are guaranteed to affect decorator behavior
- **Clean Isolation**: Tests don't interfere with each other due to cached modules

### File Structure

```
tests/caching/
├── cache.decorator.spec.ts     # Main test file with dynamic imports
├── cache-test-class.ts         # Reusable test class for dynamic import
└── ...
```

### Important Notes

- Use `pathToFileUrl()` from Node.js `url` module for proper file URL conversion
- Query string versioning ensures Node.js treats each import as a unique module
- This approach works because file URLs with different query strings bypass Node.js module cache
- Clean up environment variables in `afterEach()` to prevent test pollution

This pattern is essential for any decorator tests that depend on environment variables or other global state that is evaluated at import time.
