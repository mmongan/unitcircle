# Unit Circle VR - 3D Code Visualization

A TypeScript-based virtual reality code visualization application that renders interactive 3D representations of code structure. Built with Babylon.js 8.54.3 and WebXR support, optimized with Vite for development and production.

**Live Demo**: [https://mmongan.github.io/unitcircle](https://mmongan.github.io/unitcircle)

## Features

- **3D Code Graph Visualization**: Interactive 3D representation of function hierarchies and dependencies
  - Function cubes with color-coded export status and call hierarchy
  - Variable spheres (exported gold, internal gray)
  - External module cylinders (blue)
  - Connection tubes visualizing function calls
- **Dynamic Signature Display**: Metadata textures on function cubes showing:
  - Function name and export status
  - File path and line numbers
  - Type information (Function/Variable/External)
- **VR-Safe Navigation**: Scene root animation prevents motion sickness in VR devices
- **Force-Directed Layout**: Physics-based node positioning for clear relationship visualization
- **Real-Time Updates**: File watcher detects code changes and regenerates visualization automatically
- **WebXR Support**: Ready for VR headsets and immersive experiences
- **Type-Safe Development**: Full TypeScript support throughout
- **Fast Build System**: Vite for instant development feedback and optimized production builds
- **Comprehensive Testing**: 180 unit tests with 72.89% code coverage

## Project Structure

```
src/
├── main.ts                  # Application entry point
├── VRSceneManager.ts        # VR scene orchestration (466 lines)
│                            # - Babylon.js setup & rendering
│                            # - Mesh creation & interaction
│                            # - Animation & texture generation
├── VRSceneManager.spec.ts   # 74 integration tests
├── CodeParser.ts            # TypeScript AST extraction (118 lines)
│                            # - Function & variable detection
│                            # - Call relationship tracking
├── CodeParser.spec.ts       # 66 unit tests
├── ForceDirectedLayout.ts   # Node positioning algorithm (195 lines)
├── ForceDirectedLayout.spec.ts # 16 physics simulation tests
├── FileWatcher.ts           # File monitoring & graph regeneration
├── FileWatcher.spec.ts      # 15 change detection tests
├── counter.ts               # Demo utility component
├── counter.spec.ts          # 40 DOM interaction tests
└── style.css                # Global styling

tests/unit/
├── CodeParser.spec.ts       # 66 tests - function extraction
├── counter.spec.ts          # 40 tests - UI component
├── managers/
│   └── VRSceneManager.spec.ts # 74 tests - 3D visualization
├── CodeTreeBuilder.spec.ts  # 14 tests - existing suite
├── FileWatcher.spec.ts      # 15 tests - file monitoring
└── ForceDirectedLayout.spec.ts # 16 tests - layout engine

scripts/
├── build-graph.ts           # Generate graph.json from source code
└── deploy.js                # GitHub Pages deployment

public/
```

## Getting Started

### Prerequisites

- **Node.js** 16+ and npm
- **TypeScript** 5.9+

### Installation

```bash
git clone <repository>
cd unitcirclevr
npm install
```

### Development

#### Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173/`

#### Watch for Code Changes

Watch source code and regenerate visualization:

```bash
npm run dev:watch
```

This runs file watcher and dev server concurrently.

#### Generate Code Graph

Manually regenerate the function dependency graph:

```bash
npm run graph:build
```

Outputs to `public/unitcircle/graph.json` containing:
- 65 functions extracted from `src/VRSceneManager.ts`
- Function metadata (name, export status, file, line numbers)
- Call relationships and dependencies

## Testing

### Run All Tests

```bash
npm test
```

**Results**: 180/180 tests passing (100%)

### Coverage Report

Generate detailed coverage report:

```bash
npm test -- --coverage
```

### Coverage Summary

| File | Statements | Branches | Functions | Tests |
|------|-----------|----------|-----------|-------|
| CodeParser.ts | 100% ✅ | 92.85% | 100% ✅ | 66 |
| counter.ts | 100% ✅ | 100% ✅ | 100% ✅ | 40 |
| ForceDirectedLayout.ts | 95.68% | 80.76% | 85.71% | 16 |
| VRSceneManager.ts | 55.81% | 71.42% | 70.96% | 74 |
| **Overall** | **72.89%** | **81.37%** | **81.66%** | **180** |

### Test Infrastructure

- **Framework**: Vitest 2.0.0
- **DOM Testing**: jsdom environment
- **Mocking**: Babylon.js mocked for unit tests (no WebGL context required)
- **Coverage**: v8 provider with HTML reports in `coverage/` directory

## Building for Production

Create an optimized production build:

```bash
npm run build
```

Build process:
1. Runs `graph:build` to generate graph.json
2. Transpiles TypeScript with `tsc`
3. Bundles with Vite (2174+ modules optimized)
4. Generates minified assets in `dist/`

**Build time**: ~10 seconds
**TypeScript errors**: 0

Preview the production build:

```bash
npm run preview
```

## Deployment to GitHub Pages

The project is configured for automatic deployment to GitHub Pages at `https://mmongan.github.io/unitcircle`

### Setup

Ensure your GitHub repository is properly configured:

1. Repository must be public
2. GitHub Pages enabled (Settings → Pages)
3. Deploy from `main` branch (default for GitHub Pages)
4. Git credentials configured

### Deploy

Deploy the latest build to GitHub Pages:

```bash
npm run deploy
```

This command:
1. Runs full build pipeline (`graph:build` → `tsc` → `vite build`)
2. Pushes compiled files to GitHub Pages hosting
3. GitHub Pages automatically serves at `https://mmongan.github.io/unitcircle`

**Deployment time**: ~30 seconds
**Verification**: Check GitHub Actions for status

### Verify Deployment

After running `npm run deploy`:

1. Visit [https://mmongan.github.io/unitcircle](https://mmongan.github.io/unitcircle)
2. Should see 3D code visualization loading
3. Ground plane and function nodes visible after ~2 seconds
4. (Optional) For VR: Use WebXR-capable device or WebXR emulator

## Architecture

### VRSceneManager (Core 3D Engine)

Orchestrates the Babylon.js 3D visualization with:

- **Scene Hierarchy**: TransformNode parent for all game objects
- **Camera**: Fixed at (0, 0, -70) for VR safety
- **Shader Materials**: Emissive colors for function hierarchy visualization
- **Dynamic Textures**: Canvas-based signature rendering on cube faces
- **Animation**: 800ms scene root movement for smooth top-down viewing
- **Interaction**: Click/hover handlers with tooltip display

**Key Methods**:
- `renderCodeGraph()` - Parse graph.json and render 3D objects
- `createFunctionMesh()` - Create color-coded function cubes with signatures
- `createSignatureTexture()` - Generate metadata textures dynamically
- `sceneRootFlyTo()` - Animate scene to focus on object

### CodeParser (Code Analysis)

Extracts function definitions and call relationships using TypeScript compiler API:

- **Regex-based detection** for function declarations
- **AST-aware** keyword filtering (skips `if`, `while`, `const`, etc.)
- **Line number tracking** for source map generation
- **Call graph construction** from function invocations

### ForceDirectedLayout (Node Positioning)

Physics-based algorithm positioning nodes in 3D space:

- **100 simulation iterations** balancing forces
- **Attractive forces** for connected nodes
- **Repulsive forces** for node separation
- **Bounds constraints** limiting space
- **Stability checks** ensuring convergence

### FileWatcher (Development)

Monitors source file changes and regenerates visualization:

- **Debouncing** (500ms) to avoid redundant regeneration
- **Selective watching** of TypeScript files only
- **Error tolerance** - continues on parse failures
- **Automatic updates** reflected in 800ms

## Color Coding

Function nodes are color-encoded by call hierarchy:

- **Cyan**: Exported functions (called or exported to module)
- **Random palette** (5 colors): Non-exported with outgoing calls
- **Light gray**: Leaf functions (no outgoing calls)
- **Gold/Gray**: Variables (exported/internal)
- **Blue**: External modules

## Interaction Guide

### Hover
- Hover over any node to highlight it white
- Tooltip appears showing name, file path, and line number

### Click
- Click any function cube to fly to top-down view
- Scene animates smoothly (800ms) to focus on target
- Function signature visible on cube face

### Navigation
- Standard Babylon.js camera controls
- Right-click drag to rotate
- Scroll to zoom

## Technologies

| Package | Version | Purpose |
|---------|---------|---------|
| @babylonjs/core | 8.54.3 | 3D rendering engine |
| @babylonjs/loaders | 8.54.3 | 3D asset loading |
| @babylonjs/serializers | 8.54.3 | Serialization utils |
| TypeScript | 5.9.3 | Type-safe language |
| Vite | 7.3.1 | Build tooling |
| Vitest | 2.0.0 | Unit test framework |
| jsdom | Latest | DOM simulation |

## Performance

- **Build time**: 10.88 seconds
- **Test execution**: 4.59 seconds (180 tests)
- **Coverage generation**: ~10 seconds
- **Dev server startup**: ~2 seconds
- **Scene render**: 60 FPS (Babylon.js render loop)
- **Graph polling**: Every 2 seconds
- **Animation**: 800ms smooth transitions

## Browser Compatibility

- **Chrome/Edge** 85+ (WebXR support)
- **Firefox** 79+
- **Safari** 14.1+ (limited WebXR)
- **Mobile** (iOS Safari with WebXR polyfill)

## Development Workflow

1. **Make code changes** in `src/`
2. **Run `npm run dev:watch`** to see visualization update
3. **Write tests** in `tests/unit/`
4. **Run `npm test`** to validate
5. **Commit** with clear messages
6. **Deploy** with `npm run deploy`

## Troubleshooting

### Graph not rendering

- Check `public/unitcircle/graph.json` exists
- Run `npm run graph:build` manually
- Check browser console for errors

### Tests failing

- Ensure `npm install` completed successfully
- Check for TypeScript compilation errors: `npx tsc --noEmit`
- Run specific test file: `npm test -- CodeParser.spec.ts`

### Deploy not working

- Verify GitHub Pages is enabled in repository settings
- Check `main` branch is selected as source
- Run `git status` to ensure all changes committed
- Check GitHub Actions for deployment logs

## Contributing

PRs welcome! Please ensure:

1. All tests pass: `npm test`
2. Coverage doesn't decrease: `npm test -- --coverage`
3. No TypeScript errors: `npx tsc --noEmit`
4. Clear commit messages
5. Animated GIFs of visual changes appreciated

## License

MIT - See LICENSE file for details

## Related Links

- [Babylon.js Documentation](https://doc.babylonjs.com/)
- [WebXR Specification](https://www.w3.org/TR/webxr/)
- [Vite Documentation](https://vitejs.dev/)
- [Live Demo](https://mmongan.github.io/unitcircle)
