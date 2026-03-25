# Testing Guide

## Overview

Unit Circle VR has comprehensive test coverage with **255 tests** across **8 test files**.

## Test Infrastructure

- **Framework**: [Vitest 2.0.0](https://vitest.dev/)
- **Environment**: jsdom (browser-like DOM)
- **Coverage**: v8 provider with HTML reports
- **Configuration**: `vitest.config.ts`

## Running Tests

### Run All Tests

```bash
npm test
```

Output:

```text
 Test Files  8 passed (8)
  Tests  255 passed (255)
   Duration  ~5s
```

### Run Specific Test File

```bash
npm test -- CodeParser.spec.ts
npm test -- VRSceneManager.spec.ts
npm test -- counter.spec.ts
```

### Watch Mode (Recommended for Development)

```bash
npm test -- --watch
```

Tests re-run automatically on file changes.

### Coverage Report

Generate detailed coverage analysis:

```bash
npm test -- --coverage
```

Creates HTML report in `coverage/index.html`:

- Per-file coverage metrics
- Uncovered line highlighting
- Branch coverage analysis

## Test Suites

### VRSceneManager.spec.ts (89 tests)

Tests the core 3D visualization engine using mocked Babylon.js.

**Test Categories**:

| Category | Tests | Focus |
| --- | --- | --- |
| Constructor | 7 | Engine, scene, camera, lighting setup |
| Graph Loading | 5 | Loading graph.json with error handling |
| Scene Root & Transforms | 3 | Node hierarchy, parenting |
| Mesh Creation | 10 | Function/variable/external mesh types |
| Signature Textures | 10 | Dynamic texture generation, metadata |
| Node Interaction | 8 | Hover, click, tooltip behavior |
| Animation | 5 | Scene root flight-to animations |
| Edge Rendering | 5 | Tube creation for connections |
| Labels | 6 | Label planes and positioning |
| Tooltips | 8 | Tooltip creation and management |
| Lifecycle | 3 | run() and dispose() methods |
| Graph Updates | 6 | Polling and refresh behavior |
| Error Handling | 3 | WebXR failures, network errors |
| File Box Overlap Resolution | 4 | AABB separation, convergence |
| Edge Obstruction Resolution | 4 | Non-endpoint box avoidance |
| Exported Function Face Placement | 4 | Optimal face selection |
| File Box Autosizing | 1 | Exported surface preservation and per-axis resize |
| Post-resize collision pipeline | 2 | Required collision passes and call order |

**Babylon.js Mocking**:

All Babylon.js objects are mocked to enable testing without WebGL context.
The `Vector3` mock includes a working `clone()` that returns a plain copy:

```typescript
Vector3: vi.fn((x, y, z) => {
  const v: any = { x, y, z, add: vi.fn(), subtract: vi.fn() };
  v.clone = vi.fn(() => ({ x: v.x, y: v.y, z: v.z }));
  return v;
}),
```

Private layout methods (`resolveFileBoxOverlapsByMesh`, `resolveEdgeObstructions`,
`placeExportedFunctionsOnOptimalFace`) are tested directly by populating internal
maps (`fileBoxMeshes`, `currentEdges`, `nodeToFile`, `nodeMeshMap`, `graphNodeMap`)
via `(manager as any)`.

### SceneConfig.spec.ts (8 tests)

Tests static configuration constants, including the new edge radius values.

**Test Categories**:

| Category | Tests | Focus |
| --- | --- | --- |
| Edge Radius Constants | 4 | `INTERNAL_EDGE_RADIUS`, `EDGE_RADIUS` values and relationship |
| Other Constants | 4 | Box sizes, animation timing, poll interval |

### MeshFactory.spec.ts (10 tests)

Tests 3D mesh creation, focusing on edge cylinder diameter selection and material visibility.

**Test Categories**:

| Category | Tests | Focus |
| --- | --- | --- |
| Cylinder diameter | 4 | Same-file → `INTERNAL_EDGE_RADIUS×2`; cross-file/exported → `EDGE_RADIUS×2` |
| Material visibility | 3 | Same-file material `alpha=0.4`; cross-file `alpha=0`; visible difference |
| General behaviour | 3 | One cylinder per edge, empty list, clear before recreate |

**Key test pattern**:

```typescript
factory.createEdges(
  [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
  new Map()
);
// First StandardMaterial created = sameFileEdgeMaterial
const mat = vi.mocked(BABYLON.StandardMaterial).mock.results[0].value;
expect(mat.alpha).toBe(0.4);
```

### CodeParser.spec.ts (66 tests)

Tests TypeScript function extraction and call relationship analysis.

**Test Categories**:

| Category | Tests | Focus |
| --- | --- | --- |
| Extraction | 7 | Single/multiple files, empty files |
| Declarations | 9 | Named/arrow/async functions, methods |
| Calls | 10 | Call tracking, multiple calls, nested |
| Keywords | 2 | Filtering JavaScript/TypeScript keywords |
| Edge Cases | 18 | Malformed code, unicode, large files |
| Performance | 2 | 50+ files, deeply connected graphs |

**Key Tests**:

```typescript
// Extract functions from TypeScript
test('should extract named function declarations', async () => {
  const result = await CodeParser.parseSourceFiles(
    new Map([['test.ts', 'function hello() {}']]))
  expect(result.functions.size).toBeGreaterThan(0)
})

// Track function calls
test('should extract function calls within same file', async () => {
  const result = await CodeParser.parseSourceFiles(
    new Map([['test.ts', `
      function caller() { callee(); }
      function callee() { return 42; }
    `]]))
  expect(result.calls.size).toBeGreaterThan(0)
})
```

### counter.spec.ts (40 tests)

Tests DOM manipulation and click event handling.

**Test Categories**:

| Category | Tests | Focus |
| --- | --- | --- |
| Initialization | 2 | Setup and display |
| Incrementing | 8 | Single/multiple clicks, rapid fire |
| State | 4 | Multiple instances, independent state |
| DOM | 6 | Text formatting, content updates |
| Events | 4 | Click handlers, event delegation |
| Edge Cases | 3 | Zero values, clearing, reinitialization |

**Example Test**:

```typescript
test('each button instance maintains independent state', () => {
  const buttonA = document.createElement('button')
  const buttonB = document.createElement('button')
  
  setupCounter(buttonA)
  setupCounter(buttonB)
  
  for (let i = 0; i < 3; i++) buttonA.click()
  for (let i = 0; i < 7; i++) buttonB.click()
  
  expect(buttonA.innerHTML).toBe('count is 3')
  expect(buttonB.innerHTML).toBe('count is 7')
})
```

### ForceDirectedLayout.spec.ts (16 tests)

Tests physics-based node positioning algorithm.

**Existing Tests**:

- Initialization with node and edge lists
- Simulation convergence
- Position constraints within bounds
- Connected node attraction
- Complex graph handling (50+ nodes)
- Stability and label positioning

### FileWatcher.spec.ts (15 tests)

Tests file change detection and graph regeneration.

**Existing Tests**:

- File creation/modification/deletion
- Debouncing behavior (500ms)
- Selective TypeScript file watching
- Nested directory handling
- Error handling and recovery

### CodeTreeBuilder.spec.ts (14 tests)

Tests graph.json generation from source code.

**Existing Tests**:

- Output structure validation
- Function node construction
- Variable and external module nodes
- Edge creation from call relationships

## Coverage Analysis

### Current Coverage by File

```text
All files          |  72.89 | 81.37 | 81.66 |
CodeParser.ts      |    100 | 92.85 |   100 |  ✅ Excellent
counter.ts         |    100 |   100 |   100 |  ✅ Perfect
ForceDirectedLayout|  95.68 | 80.76 | 85.71 |  ✅ Good
VRSceneManager.ts  |  55.81 | 71.42 | 70.96 |  ⚠️  Mocking complexity
```

### Why VRSceneManager Coverage is Lower

VRSceneManager has lower coverage (55.81%) due to its complexity:

- **Babylon.js Integration**: Many mocked methods are trivially tested
- **Async Operations**: Graph polling and async initialization patterns
- **Network Requests**: Mocked fetch responses (success/failure)
- **WebXR Setup**: Platform-specific VR initialization
- **Mesh Operations**: Complex 3D object creation with many parameters

**Covered Functionality**:

- Constructor and initialization ✅
- Scene hierarchy and transforms ✅
- Mesh creation and materials ✅
- Dynamic texture generation ✅
- Interaction handlers ✅
- Animation logic ✅

## Writing New Tests

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { MyModule } from '../../src/MyModule'

describe('MyModule', () => {
  describe('Method Name', () => {
    it('should do something', () => {
      const result = MyModule.method()
      expect(result).toBe(expectedValue)
    })
  })
})
```

### Best Practices

1. **Descriptive Names**: Test names should answer "what should happen"

   ```typescript
   // ✅ Good
   it('should increment counter by 1 on each click', () => {})
   
   // ❌ Bad
   it('tests counter', () => {})
   ```

2. **Arrange-Act-Assert**: Clear test structure

   ```typescript
   it('should calculate sum correctly', () => {
     // Arrange
     const a = 5, b = 3
     
     // Act
     const result = add(a, b)
     
     // Assert
     expect(result).toBe(8)
   })
   ```

3. **One Assertion Focus**: Test one behavior per test

   ```typescript
   // ✅ Good: Focused tests
   it('should create function with correct color', () => {})
   it('should attach signature texture to function', () => {})
   
   // ❌ Bad: Multiple concerns
   it('should create function and texture and material', () => {})
   ```

4. **Use beforeEach for Setup**:

   ```typescript
   describe('API', () => {
     let api
     
     beforeEach(() => {
       api = new API()
     })
     
     it('should fetch data', () => {
       // api is fresh for each test
     })
   })
   ```

5. **Mock External Dependencies**:

   ```typescript
   vi.mock('../external', () => ({
     fetch: vi.fn(() => Promise.resolve({ ok: true }))
   }))
   ```

## Common Testing Patterns

### Testing Async Code

```typescript
it('should load graph data', async () => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ nodes: [] })
    })
  )
  
  const manager = new VRSceneManager(canvas)
  await new Promise(resolve => setTimeout(resolve, 100))
  
  expect(manager).toBeDefined()
})
```

### Testing DOM Events

```typescript
it('should handle click events', () => {
  const button = document.createElement('button')
  setupCounter(button)
  
  button.click()
  expect(button.innerHTML).toBe('count is 1')
})
```

### Testing Error Handling

```typescript
it('should handle network errors gracefully', async () => {
  global.fetch = vi.fn(() =>
    Promise.reject(new Error('Network error'))
  )
  
  const manager = new VRSceneManager(canvas)
  await new Promise(resolve => setTimeout(resolve, 100))
  
  expect(manager).toBeDefined()
})
```

## Debugging Tests

### Run Single Test

```bash
npm test -- --run CodeParser.spec.ts
```

### Run Tests Matching Pattern

```bash
npm test -- -t "should extract functions"
```

### Debug in VS Code

Add `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
  "args": ["--inspect-brk"],
  "console": "integratedTerminal"
}
```

Press F5 to start debugging.

## CI/CD Integration

Tests run automatically on:

1. **Pre-commit**: (Configure with husky)

   ```bash
   npm test -- --run
   ```

2. **Pull Requests**: GitHub Actions recommended
3. **Before Deploy**: `npm run deploy` includes test run

## Performance

- **Test execution**: ~5 seconds (255 tests)
- **Coverage generation**: ~12 seconds
- **Watch mode rerun**: <1 second per file change

## Maintenance

### Adding New Tests

When adding features:

1. Write tests first (TDD) or alongside implementation
2. Run `npm test` to verify
3. Check coverage: `npm test -- --coverage`
4. Target 80%+ coverage on new code

### Updating Mocks

If Babylon.js API changes:

1. Update mocks in `VRSceneManager.spec.ts`
2. Run tests to verify compatibility
3. Update implementation if needed

### Coverage Goals

- **Overall**: >70% ✅ (currently 72.89%)
- **Critical Paths**: >90%
  - CodeParser ✅ 100%
  - counter ✅ 100%
  - ForceDirectedLayout ✅ 95.68%
- **Complex Modules**: >50%
  - VRSceneManager ✅ 55.81%

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library Best Practices](https://testing-library.com/docs/)
- [Jest Matchers Reference](https://vitest.dev/api/expect.html)
