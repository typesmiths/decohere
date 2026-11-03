# Unit Test Design Principles

**Normative:** [testing](../) — behavior over internals. Behavior suites come first. `toHaveBeenCalled` / `vi.mock` are for **edges the behavior suite cannot see**, not the default assertion.

This article is only the “don’t test the mock’s return value” how-to.

## Core Principle: Test Your Code, Not Your Mocks

When a unit test must mock a dependency, assert **your code’s behavior**, not that a mock echoed what you configured.

## The Anti-Pattern

```typescript
// ❌ BAD: Testing the mock, not the code
it("should return files", async () => {
    vi.mocked(findFiles).mockResolvedValue([
        { path: "src/index.ts" }, 
        { path: "src/utils.ts" }
    ]);

    const files = await service.getFiles(project, { include: ["**/*.ts"] });

    // These assertions test the mock, not the service
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/index.ts");
    expect(files[1].path).toBe("src/utils.ts");
});
```

**Problem**: The test will pass as long as the mock returns the data. It doesn't verify that the service does anything meaningful with that data.

## What to Test Instead

### 1. Prefer an observable outcome

If the service’s job is “return matching files,” assert the files (or the written tree / HTTP body). A `toHaveBeenCalledWith` check is an **edge** when the collaborator is the only way to see a transformation the behavior suite cannot see:

```typescript
// Edge: argument shaping the behavior suite cannot observe
it("passes include patterns through to findFiles", async () => {
    await service.getFiles(project, {
        include: ["src/**/*.ts", "lib/**/*.ts"],
    });

    expect(findFiles).toHaveBeenCalledWith(
        ["src/**/*.ts", "lib/**/*.ts"],
        {
            cwd: "/test/project",
            ignore: undefined,
        }
    );
});
```

### 2. Data Transformation Logic

Test how your code **transforms** data from dependencies:

```typescript
// ✅ GOOD: Testing transformation logic
it("should convert absolute paths to relative paths", async () => {
    vi.mocked(findFiles).mockResolvedValue([
        { path: "/test/project/src/index.ts" }
    ]);

    const files = await service.getFiles(project, { include: ["**/*.ts"] });

    // This tests the service's path transformation logic
    expect(files[0].relativeFilePath).toBe("src/index.ts");
    expect(files[0].project).toBe("test-project");
});
```

### 3. Business Logic and Edge Cases

Test decision-making, calculations, filtering, error handling:

```typescript
// ✅ GOOD: Testing business logic
it("should filter out files matching ignore patterns", async () => {
    // This tests the service's filtering logic
    await service.getFiles(project, {
        include: ["**/*.ts"],
        ignore: ["**/*.spec.ts"]
    });

    expect(findFiles).toHaveBeenCalledWith(
        ["**/*.ts"],
        expect.objectContaining({ ignore: ["**/*.spec.ts"] })
    );
});

// ✅ GOOD: Testing error handling
it("should propagate errors with context", async () => {
    vi.spyOn(io, "readFile").mockRejectedValue(new Error("Disk error"));

    await expect(service.getFileContent(sourceFile))
        .rejects.toThrow("Failed to read src/index.ts: Disk error");
});
```

### 4. State Management

Test how your code manages internal state:

```typescript
// ✅ GOOD: Testing caching behavior
it("should cache files by path", async () => {
    vi.mocked(findFiles).mockResolvedValue([{ path: "src/index.ts" }]);

    const files1 = await service.getFiles(project, { include: ["**/*.ts"] });
    const files2 = await service.getFiles(project, { include: ["**/*.ts"] });

    // Tests that the service caches and returns the same instance
    expect(files1[0]).toBe(files2[0]);
});
```

## Decision Framework

When writing a test assertion, ask:

1. **"If I remove this code, will the test fail?"**
   - If no → you're likely testing the mock
   - If yes → you're testing your code

2. **"What part of MY code does this assertion verify?"**
   - Argument construction/transformation
   - Data transformation/enrichment
   - Business logic/decision-making
   - State management
   - Error handling

3. **"Could this assertion pass even if my code is completely wrong?"**
   - If yes → reconsider the assertion

## When Return Value Assertions ARE Valuable

Assert on return values when testing:

- **Transformation logic**: Your code changes/enriches the data
- **Combination logic**: Your code merges data from multiple sources
- **Derived values**: Your code computes new values from the input
- **Type conversion**: Your code converts between different shapes

```typescript
// ✅ GOOD: Testing actual transformation
it("should add cache keys to source files", async () => {
    vi.mocked(findFiles).mockResolvedValue([{ path: "src/index.ts" }]);
    vi.spyOn(io, "readFile").mockResolvedValue("const x = 1;");

    const files = await service.getFiles(project, { include: ["**/*.ts"] });
    await service.getFileContent(...files);

    // Tests that service computes cache keys from content
    expect(files[0].cacheKey).toBe("abc123hash");
});
```

## Integration vs Unit Testing

- **Unit tests**: Mock dependencies, test your code's logic in isolation
- **Integration tests**: Use real dependencies when possible, test the full interaction

If you find yourself wanting to assert on pass-through data, consider whether you need an integration test instead.

## Summary

**Test the behavior of your code, not the behavior of your mocks.** Prefer canonical behavior suites; reserve `toHaveBeenCalled` for edges those suites cannot see.

Focus on:
- ✅ How your code calls dependencies (arguments)
- ✅ How your code transforms/processes data
- ✅ How your code makes decisions
- ✅ How your code handles errors
- ✅ How your code manages state

Avoid:
- ❌ Asserting on raw mocked return values without transformation
- ❌ Testing that mocks work as configured
- ❌ Repeating mock values in assertions
