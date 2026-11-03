# Vitest Mocking with Type Safety

## Mandatory Pattern (Team Standard)

Use this pattern for service tests in this repo:

1. **Mock only minimal external dependencies** needed by the unit under test.
2. **Mock entire dependency modules with hoisted `vi.mock(...)`** (not ad-hoc inline object stubs passed to constructors).
3. **Instantiate mocked classes via constructors** so TypeScript enforces real interfaces at compile time.
4. **Do not redefine dependency shapes manually** (e.g. `{ sourceFileChanged$: new Subject() } as never`).
5. **Do not replace observable contracts with local stand-ins** unless the dependency API itself exposes that exact type.

Why this is mandatory:
- Prevents tests from passing after unsafe refactors due to structural type escapes.
- Preserves compile-time breakage when dependency contracts change.
- Keeps tests focused on behavior, not handcrafted fake object shapes.

## Anti-Patterns (Do Not Use)

```typescript
// ❌ Not allowed: shape-stub object with type escape
const sourceFileService = {
  sourceFileChanged$: new Subject(),
  deleteTransforms: vi.fn(),
} as never;

// ❌ Not allowed: replacing observable/property shape ad-hoc in test setup
vi.spyOn(mockSourceFileService, "sourceFileChanged$", "get").mockReturnValue(new Subject());
```

These patterns can hide interface/contract drift and reduce refactor safety.

## Problem

When mocking dependencies in tests, you often lose TypeScript type safety and IntelliSense support. Using type assertions (`as`) is verbose and error-prone. Direct mocking without types can lead to runtime errors when the interface changes.

## Example Issue

```typescript
// This loses type safety:
const mockService = {
  projects: [],
  buildConfig: { targets: ["es6"] }
} as ConfigurationService; // Type assertion required

// Or this has no type safety at all:
const mockService = {
  projects: [],
  buildConfig: { targets: ["es6"] }
}; // TypeScript doesn't know what type this should be
```

## Solution: Mock + Constructor Pattern

Use Vitest's `vi.mock()` to replace the module, then instantiate the mocked class with its constructor to get a properly typed instance.

### Implementation

```typescript
// 1. Mock the module with vi.mock() - define mock implementation
vi.mock("../../src/services/configuration.service.js", () => ({
  ConfigurationService: class MockConfigurationService {
    public projects = [];
    public buildConfig = { targets: ["es6"] };
  },
}));

// 2. Import the class - TypeScript sees real type, runtime gets mock
import { ConfigurationService } from "../../src/services/configuration.service.js";

// 3. Instantiate with constructor - returns mock with correct TypeScript type
const mockConfigService = new ConfigurationService();

// 4. Pass to dependencies - full type safety, IntelliSense works
const pipelineService = new PipelineService(mockConfigService, container);
```

### Complete Test Example

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationService } from "../../src/services/configuration.service.js";
import { PipelineService } from "../../src/services/pipeline.service.js";
import { ServiceContainerBuilder } from "@decohere/crucible";

// Mock configuration service with vitest
vi.mock("../../src/services/configuration.service.js", () => ({
  ConfigurationService: class MockConfigurationService {
    public projects = [];
    public buildConfig = { targets: ["es6"] };
  },
}));

describe("PipelineService", () => {
  let containerBuilder: ServiceContainerBuilder;
  let mockConfigService: ConfigurationService;

  beforeEach(() => {
    containerBuilder = new ServiceContainerBuilder();
    // Constructor returns mock with correct TypeScript type
    mockConfigService = new ConfigurationService();
  });

  it("should use mocked configuration", async () => {
    const container = containerBuilder.build();
    // Full type safety when passing to constructor
    const pipelineService = new PipelineService(mockConfigService, container);
    
    // TypeScript knows all methods and properties
    expect(mockConfigService.projects).toEqual([]);
    expect(mockConfigService.buildConfig.targets).toEqual(["es6"]);
  });
});
```

### Key Benefits

- **Full Type Safety**: No `as` assertions needed, TypeScript validates everything
- **IDE Support**: Full IntelliSense, autocomplete, and type checking
- **Refactor-Safe**: TypeScript will error if the interface changes
- **Clean Code**: Simple, readable instantiation pattern
- **Consistent Behavior**: Vitest ensures the mock is used everywhere the module is imported
- **Contract Safety**: Prevents accidental test pass-through from loose shape stubs

### How It Works

1. **Hoisting**: `vi.mock()` is hoisted to the top of the file before imports
2. **Module Replacement**: Vitest replaces the module with your mock implementation
3. **Type Preservation**: The import statement still has TypeScript's real type information
4. **Runtime Substitution**: At runtime, the constructor creates your mock instance
5. **Type Inference**: TypeScript infers the variable has the real class type

### Important Notes

- `vi.mock()` is hoisted, so it cannot reference variables defined elsewhere in the file
- Define mock implementation inline within the `vi.mock()` factory function
- Import the real class after mocking - TypeScript sees the real type, runtime gets the mock
- Use constructor to instantiate - returns mock with correct TypeScript type
- This pattern works for any class-based dependency
- Keep dependency mocking minimal: mock only collaborators needed by the scenario
- Prefer asserting behavior through public API over calling private members directly

### Comparison with Other Patterns

#### ❌ Type Assertion (Verbose)
```typescript
const mockService = {
  projects: [],
  buildConfig: { targets: ["es6"] }
} as ConfigurationService;
```

#### ❌ No Types (Unsafe)
```typescript
const mockService = {
  projects: [],
  buildConfig: { targets: ["es6"] }
};
```

#### ❌ Shape-Stub + Escape (Brittle)
```typescript
const sourceFileService = {
  sourceFileChanged$: new Subject(),
  deleteTransforms: vi.fn(),
} as never;
```

#### ✅ Mock + Constructor (Best)
```typescript
vi.mock("../../src/services/configuration.service.js", () => ({
  ConfigurationService: class MockConfigurationService {
    public projects = [];
    public buildConfig = { targets: ["es6"] };
  },
}));
import { ConfigurationService } from "../../src/services/configuration.service.js";
const mockService = new ConfigurationService();
```

Use this when a unit test must mock a collaborator. Prefer a behavior suite when the same outcome is visible via files, HTTP, or exit ([testing](../)).

## Review Checklist

Before submitting a test, verify:

- [ ] Are only minimal dependencies mocked?
- [ ] Are dependency modules mocked with hoisted `vi.mock(...)`?
- [ ] Are mocked services created through constructors (type-safe), not shape stubs?
- [ ] Did we avoid `as never` for dependency-object fakes?
- [ ] Would a dependency contract refactor fail this test at compile time?
