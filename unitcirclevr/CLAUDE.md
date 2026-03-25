# Claude Working Guide - Unit Circle VR Project

## Project Overview

**Unit Circle VR** is a 3D interactive code visualization tool that renders TypeScript/JavaScript project dependency graphs in Babylon.js. It transforms static code structure into an immersive VR-ready visualization where functions, variables, and external modules are represented as geometric shapes connected by semantic edges.

### Key Technologies
- **Babylon.js** - 3D graphics and scene management
- **TypeScript** - Source language with full type safety
- **Vite** - Build tool and dev server
- **Vitest** - Unit testing framework
- **Three.js/Babylon.js** - WebGL rendering

### Project Structure
```
src/
  ├── CodeParser.ts          # Extract dependencies from TypeScript
  ├── ForceDirectedLayout.ts # Physics-based node positioning
  ├── GraphLoader.ts         # Load and manage graph data
  ├── GraphViewer.ts         # 2D canvas visualization (fallback)
  ├── MeshFactory.ts         # Create/manage 3D geometries and materials
  ├── SceneConfig.ts         # Babylon.js scene configuration
  ├── VRSceneManager.ts      # VR-specific scene management
  ├── VRGraphViewer.ts       # Main VR viewer application
  ├── main.ts                # Entry point
  └── types.ts               # Shared TypeScript interfaces

tests/
  └── unit/                  # Comprehensive unit test suite (240+ tests)

scripts/
  ├── CodeTreeBuilder.ts     # AST parsing and dependency extraction
  ├── FileWatcher.ts         # Monitor source changes
  └── build-graph.ts         # Generate graph.json from source

docs/
  ├── ARCHITECTURE.md        # System design and component relationships
  ├── TESTING.md             # Test strategy and coverage
  └── CONTRIBUTING.md        # Development guidelines
```

---

## Claude AI Assistant Guidelines

### How I Work With This Project

#### 1. **Autonomy & Testing First**
- I **automatically apply all changes** without asking for approval
- **ALL tests must pass** (currently 240/240) before marking work complete
- **Zero TypeScript compilation errors** required
- Check the Problems tab to ensure clean output

#### 2. **Code Quality Standards**
- Extract functions and organize imports using Pylance refactoring tools when improving code
- Maintain 100% test coverage expectations for new features
- Write JSDoc comments for public methods
- Use Map and Set data structures where appropriate (existing pattern in MeshFactory)

#### 3. **3D Graphics Expertise**
- Babylon.js mesh creation, materials, and transformations
- Physics-based layout algorithms with repulsion and attraction forces
- Vector math for positioning and rotation (quaternions, matrix operations)
- Performance optimization through mesh reuse and indexed rendering

#### 4. **TypeScript Best Practices**
- Strict type safety (no `any` except with `as any` comments explaining why)
- Immutable data patterns where feasible
- Proper error handling and validation
- Use of mapped types and conditional types when needed

### Workflow for New Features

1. **Read existing code patterns** - Study how MeshFactory, ForceDirectedLayout, CodeParser work
2. **Write tests first** - Add unit tests in `tests/unit/` prior to implementation
3. **Implement with context** - Apply changes using the patterns established in the codebase
4. **Verify completeness** - Ensure tests pass, no TypeScript errors, Problems tab clean
5. **Update docs** - Keep ARCHITECTURE.md and relevant docs synchronized

### Performance Considerations

- **Mesh reuse**: The MeshFactory caches meshes in Maps to avoid recreation each frame
- **Update patterns**: Use `updateEdges()` style methods for render loop optimizations
- **Layout performance**: ForceDirectedLayout uses iterative refinement with early exit conditions
- **Memory profiles**: Monitor GPU memory for large graphs (1000+ nodes)

---

## Development Notes

### Common Development Tasks

#### Running Tests
```bash
npm test              # Run all tests
npm run test -- --coverage  # With coverage report
npm run test -- FileWatcher  # Run specific test file
```

#### Development Server
```bash
npm run dev           # Start Vite dev server with hot reload
npm run preview       # Preview production build
```

#### Building
```bash
npm run build         # Create production bundle
npm run build-graph   # Generate graph.json from source
```

#### Git & Deployment
- Primary branch: `main` (not `master`)
- Push command: `git push origin HEAD:main`
- GitHub Pages serves automatically from `main` branch
- Always verify no broken builds before pushing

### Known Patterns & Conventions

#### 1. **Node Identification**
- Format: `nodeName@filePath`
- Example: `calculateSum@src/math.ts`
- Split on `@` to extract file context

#### 2. **Edge Metadata**
- Edges track `{ from, to, isCrossFile }`
- Materials vary by type:
  - Same-file edges: Gray (0.8, 0.8, 0.8)
  - Cross-file edges: Golden (1.0, 0.84, 0.0)
  - Exported connections: Bright yellow (1.0, 1.0, 0.0)

#### 3. **Mesh Scaling**
- Box size = `baseSize + log(indegree + 1) * scaleFactor`
- Logarithmic scaling prevents extreme size variations
- Spheres/cylinders use fixed config values

#### 4. **Texture Rendering**
- Dynamic textures for function signatures (512px default)
- Canvas-based text rendering with dark semi-transparent panels
- `update()` required after drawing on DynamicTexture

### Testing Strategy

#### Test Organization
```
tests/unit/
  ├── CodeParser.spec.ts      # ~20 tests on parsing rules
  ├── ForceDirectedLayout.spec.ts # Physics & convergence
  ├── GraphViewer.spec.ts      # Canvas rendering
  ├── VRGraphViewer.spec.ts    # VR-specific rendering
  └── managers/
      └── VRSceneManager.spec.ts
```

#### Mock Pattern
- Use `vitest.mock()` for Babylon.js dependencies
- Create minimal mock scenes with `createMockScene()`
- Test data uses simple GraphNode arrays

#### Coverage Targets
- Unit tests: 85%+ line coverage
- Critical paths: 100% (mesh creation, edge updates, layout)
- Edge cases: Zero velocity, NaN handling, empty graphs

### Debugging Tips

1. **Babylon.js Inspector**: Press `Ctrl+Alt+I` in browser to inspect scene
2. **Layout issues**: Check ForceDirectedLayout iteration counts and convergence threshold
3. **Texture not showing**: Verify `dynamicTexture.update()` was called
4. **Performance drops**: Use Chrome DevTools to identify render bottlenecks
5. **Type errors**: Run `npx tsc --noEmit` to check compilation

### Code Review Checklist (Self-Apply)

- [ ] All new public methods have JSDoc comments
- [ ] Tests pass: `npm test`
- [ ] No TypeScript errors: Check Problems tab
- [ ] No unused imports or variables
- [ ] No `console.log()` statements in production code
- [ ] Docs updated if feature changes public API
- [ ] Git commit message is descriptive and atomic

---

## Project Statistics

- **Total Tests**: 240 passing
- **Lines of Code**: ~2,500 (source only)
- **Main Dependencies**: @babylonjs/core, vite
- **TypeScript Strict Mode**: Yes
- **Node Support**: v18+

---

## Quick Reference Commands

```bash
# Testing
npm test
npm run test -- --coverage --reporter=verbose

# Development
npm run dev
npm run build
npm run preview

# Graph generation
npm run build-graph

# Code analysis
npx tsc --noEmit
npx eslint src/

# Deployment
git push origin HEAD:main
```

---

## Resources

- [Babylon.js Documentation](https://doc.babylonjs.com/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Guide](https://vitest.dev/)
- [Project Architecture](./docs/ARCHITECTURE.md)
- [Testing Guidelines](./docs/TESTING.md)

