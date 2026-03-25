# Architecture Guide

## System Overview

Unit Circle VR visualizes code structure as an interactive 3D graph where:

- **Functions** = Colored cubes (file-color tinted; exported = bright white; internal = semi-transparent)
- **Variables** = Gold or gray spheres
- **External Modules** = Blue cylinders
- **File Boxes** = Transparent tinted glass containers (per file)
- **Cross-file edges** = Golden cylinders (thicker)
- **Same-file edges** = Gray cylinders (thinner, semi-transparent)

The system automatically extracts TypeScript code, calculates positions using force-directed physics, and renders everything with Babylon.js in a VR-safe manner.

## High-Level Data Flow

```text
Source Code (src/VRSceneManager.ts)
          ↓
    [CodeParser]
    - Extract functions
    - Parse calls
    ↓
    [CodeTreeBuilder]
    - Build graph.json
    ↓
    graph.json (65 functions, 6 calls)
    ↓
    [VRSceneManager loads at runtime]
    ↓
    [ForceDirectedLayout]
    - Calculate node positions
    ↓
    3D Visualization
    - Babylon.js rendering
    - 60 FPS render loop
    - Real-time updates via FileWatcher
    ↓
    Browser Display
    - VR-safe scene root animation
    - Click-to-focus interactions
    - Signature texture display
```

## Module Architecture

### VRSceneManager (Core Engine)

**Purpose**: Orchestrates all 3D visualization using Babylon.js 8.54.3

**Responsibilities**:

- Scene initialization (lighting, camera, ground)
- Graph loading and parsing
- Mesh creation (functions, variables, externals)
- Material and texture management
- Interaction handling (hover, click)
- Animation and position updates
- WebXR integration

**Key Data Structures**:

```typescript
interface GraphData {
  nodes: {
    id: string                           // Unique identifier
    name: string                         // Function/variable name
    file?: string                        // Source file path
    line?: number                        // Line number in source
    isExported?: boolean                 // Export status
    type?: 'function' | 'variable' | 'external'
  }[]
  edges: {
    from: string                         // Caller function ID
    to: string                           // Called function ID
  }[]
  lastUpdated: string                    // ISO timestamp
}
```

**Color Encoding**:

```typescript
// Function boxes
Exported:          White      (0.95, 0.95, 1.0)  emissive, opaque
Internal:          File color  semi-transparent (alpha 0.8)

// Variable nodes
Exported:          Gold       (file-color based)
Internal:          Gray       subtle

// External modules
External:          Dim gray   subtle

// Edges
Cross-file:        Golden     (1.0, 0.84, 0.0)  radius EDGE_RADIUS
Exported-target:   Bright yellow (1.0, 1.0, 0.0) radius EDGE_RADIUS
Same-file internal: Dim gray  (0.5, 0.5, 0.5)  radius INTERNAL_EDGE_RADIUS (4× thinner)
                               alpha 0.4 (semi-transparent)
```

**Camera Setup**:

```typescript
Position: (0, 0, -70)      // Fixed, don't move with scene
Inertia: 0.5               // Smooth motion
Sensitivity: 1000          // Reduced for precision
```

**Scene Root Hierarchy**:

```text
Scene
└── sceneRoot (TransformNode)
    ├── ground
   ├── filebox_<file> (Box, transparent glass, file-color tint)
    │   ├── filelabel_<file> (Plane, billboard)
    │   ├── func_<id>  (Box — exported function)
    │   ├── func_<id>  (Box — internal function)
    │   └── ...
    ├── filebox_<file2> ...
    ├── edge_0 … edge_N (Cylinder — repositioned each frame)
    └── ext_<id>, var_<id> (external / variable nodes)
```

All objects parented to `sceneRoot` for VR-safe animation that doesn't move camera.
Function nodes are parented to their file box so they move with the box.

**Animation Parameters**:

```typescript
Duration: 800ms
Frame Rate: 60 FPS
Frames: 48 (800ms ÷ 16.67ms per frame)
Target Z: -5 (top-down view below camera)
```

### CodeParser (Analysis Engine)

**Purpose**: Extract TypeScript functions and relationships without AST

**Approach**: Regex-based pattern matching with keyword filtering

**Algorithm**:

1. **Function Detection**:

   ```regex
   (?:(?:private|public|static|async)\s+)*
   (?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*(?::|=))
   ```

   - Matches `function name() {}`
   - Matches method declarations with type annotations
   - Matched with modifiers (private, static, async)

2. **Call Detection**:

   ```regex
   (\w+)\s*\(
   ```

   - Matches function invocations
   - Filters JavaScript keywords
   - Links caller to called functions

3. **Line Number Calculation**:

   ```typescript
   lineNumber = content.substring(0, index).split('\n').length
   ```

**Limitations**:

- Doesn't parse string literals (regex patterns treated as code)
- Can't distinguish built-in functions from user functions
- Misses some complex patterns (destructuring calls, optional chaining)

**Output**:

```typescript
{

  functions: Map<uniqueId, CodeFunction>,
  calls: Map<callerId, Set<calleeIds>>
}
```

### Two-Level Layout System

**Overview**: File boxes and function nodes are organised in a two-level hierarchy.

**Level 1 — File layout**:

- One node per source file in a `ForceDirectedLayout`.
- Cross-file dependency edges attract connected files; all files repel each other.
- Simulated once at startup (`fileLayout.simulate(600)`).
- Result placed in a square grid via `positionFileBoxesInGrid()`.

**Level 2 — File-internal layout**:

- Each file has its own `ForceDirectedLayout` for the functions it contains.
- Simulated once (`internalLayout.simulate(500)`) then frozen.
- Positions are normalised to fit within ±0.40 in local space.

**Pipeline Stages** (run once during `renderCodeGraph`):

| Stage | Method | Purpose |
| --- | --- | --- |
| 1 | `prepareRenderState()` | Reset render state and cache graph nodes |
| 2 | `buildFileNodeMaps()` | Build `nodeToFile` and `fileNodeIds` maps |
| 3 | `createAndSettleInternalLayouts()` | Build/simulate per-file internal layouts (`simulate(500)`) |
| 4 | `createAndSettleFileLevelLayout()` | Build/simulate file-level layout (`simulate(600)`) |
| 5 | `applyFileLayoutPositions()` | Apply file-level positions to file boxes |
| 6 | `fitAndSeparateFileBoxes()` | Autosize, clamp, grid place, and resolve collisions |
| 7 | `populateCurrentEdges()` | Prepare edge lookup set for edge-routing passes |
| 8 | `resolveEdgeObstructions(30)` | Push non-endpoint boxes away from cross-file edge paths |
| 9 | `placeExportedFunctionsOnOptimalFace()` | Place exported functions on optimal face centres |

Collision resolution is always run immediately after resize/reposition in `fitAndSeparateFileBoxes()`:

- `resolveInitialFileBoxOverlaps(6)`
- `enforceMinimumFileBoxGap(20.0, 6)`

**`resolveEdgeObstructions(iterations)`**:

For each unique cross-file edge A → B:

```text
For each non-endpoint file box C:
  closest = nearest point on segment A→B to C (clamped outside endpoint spheres)
  if distance(C, closest) < boundingSphereRadius(C) + 10:
    push C perpendicularly away by the deficit
  re-resolve AABB overlaps between all boxes
```

**`placeExportedFunctionsOnOptimalFace()`**:

For each exported function node N in file box F:

```text
For each of the 6 face centres of F (±X, ±Y, ±Z):
  worldFacePos = F.position + F.scaling ⊙ localFace
  cost = Σ distance(worldFacePos, remoteNeighbour)
Place N at the face centre with minimum cost (local position ±0.5 on winning axis)
```

### ForceDirectedLayout (Physics Engine)

**Purpose**: Position nodes in 3D space using physics simulation

**Algorithm**:

```text
For each iteration (up to requested count, e.g. 500 internal / 600 file-level):
   Reset node velocities
   Apply repulsive forces between all node pairs
   Apply attractive forces along graph edges
   Apply damping and integrate position
   Constrain positions to ±SPACE_SIZE bounds
   Enforce minimum pair-separation constraints
   Exit early when max velocity < EQUILIBRIUM_THRESHOLD
```

**Configuration**:

```typescript
Internal simulation iterations: 500
File-level simulation iterations: 600
Internal minimum node separation: 90.0
Damping: 0.92
Bounds: [-SPACE_SIZE, -SPACE_SIZE, -SPACE_SIZE] to [SPACE_SIZE, SPACE_SIZE, SPACE_SIZE]
```

**Performance**:

- Time complexity: O(n² × iterations) = O(n²) for small graphs
- 65 nodes: <100ms per simulation
- Converges typically within 50-60 iterations

### FileWatcher (Development Tool)

**Purpose**: Monitor source code and regenerate graph on changes

**Operation**:

```text
File system event → debounce (500ms) → regenerate graph
```

**Process**:

1. Watch `src/VRSceneManager.ts` for changes
2. Debounce events (ignore rapid changes)
3. Run `npm run graph:build`
4. Generate new `graph.json`
5. Browser polls and reloads graph

**Polling Configuration**:

```typescript
Interval: 2000ms (2 seconds)
Header: lastUpdated timestamp
Comparison: New lastUpdated > old lastUpdated?
If changed: Clear old meshes, render new graph
```

### Signature Texture System

**Dynamic Canvas Rendering**:

```typescript
// Create dynamic texture
texture = new DynamicTexture('signatureTexture_${id}', 512, scene)
ctx = texture.getContext()

// Draw signature
ctx.fillStyle = '#000000'                    // Black background
ctx.fillRect(0, 0, 512, 512)
ctx.strokeStyle = '#00ff00'                  // Green border
ctx.lineWidth = 4
ctx.strokeRect(10, 10, 492, 492)

// Draw metadata
ctx.fillStyle = '#00ff00'
ctx.font = 'bold 32px monospace'
ctx.textAlign = 'center'
ctx.textBaseline = 'top'

// Render lines with 60px spacing
lines = [name, exportStatus, filePath, lineNumber, type]
yOffset = 60
for line of lines:
  ctx.fillText(line, 256, yOffset)
  yOffset += 60

texture.update()
```

**Texture Application**:

```typescript
// Apply to cube face as emissive texture
material.emissiveTexture = signatureTexture
material.emissiveColor = white    // For bright visibility
```

**Why Emissive?**:

- Doesn't require complex lighting setup
- Visible from all angles
- Works well with orthogonal textures
- Good performance

## Build Pipeline

```text
npm run build
├── npm run graph:build
│   ├── Parse src/VRSceneManager.ts
│   ├── Extract 65 functions
│   ├── Calculate 6 calls
│   └── Generate public/unitcircle/graph.json
├── npx tsc
│   ├── Type-check all TypeScript
│   ├── Emit to dist/
│   └── Ensure 0 compilation errors
└── vite build
    ├── Bundle with 2174+ modules
    ├── Tree-shake unused code
    ├── Minify and optimize
    └── Generate dist/ with assets
```

**Output**:

- `dist/index.html` - Entry point
- `dist/unitcircle/graph.json` - Code visualization data
- `dist/assets/*.js` - Bundled JavaScript
- `dist/assets/*.css` - Compiled styles

## Data Flow During Interaction

### Click on Node

```text
1. Browser dispatches click event
   ↓
2. ActionManager detects OnPickTrigger
   ↓
3. sceneRootFlyTo(nodeWorldPosition)
   ↓
4. Calculate scene offset:
   desiredWorld = camera + offset(0, 0, -5)
   sceneOffset = desiredWorld - nodePosition
   ↓
5. Animation.CreateAndStartAnimation:
   - Duration: 800ms
   - Property: sceneRoot.position
   - From: current position
   - To: sceneOffset
   ↓
6. Each frame:
   - Recalculate scene root position
   - All child objects move relative to scene root
   - Node moves to top-down view
   - Camera stays fixed
   ↓
7. Animation complete
   - Node is at Z = -5
   - Scene root positioned to place it there
```

### Hover Over Node

```text
1. ActionManager detects OnPointerOverTrigger
   ↓
2. material.emissiveColor = white (highlight)
   ↓
3. showTooltip(node)
   - Create HTML div
   - Show node name, file, line
   - Position at top-right
   ↓
4. MouseOut → restore color, hide tooltip
```

### Graph Update (File Change)

```text
1. FileWatcher detects source change
   ↓
2. Debounce 500ms
   ↓
3. Run graph:build
   - Parse updated code
   - Generate new graph.json
   ↓
4. Browser polls every 2s
   ↓
5. Detect lastUpdated changed
   ↓
6. clearGraph()
   - Dispose old meshes
   - Dispose old textures
   ↓
7. renderCodeGraph()
   - Calculate new positions
   - Create new meshes
   - Apply new textures
   ↓
8. Visualization updated (smooth transition)
```

## Performance Optimizations

### 1. Camera Fixed Position

- Scene moves, not camera
- Prevents motion sickness in VR
- Simpler perspective mathematics

### 2. Material Reuse

```typescript
// Reuse material for multiple nodes
const material = new StandardMaterial('mat', scene)
// Apply to multiple cubes
```

### 3. Texture Caching

```typescript
// Each function gets unique texture
// No shared textures (identity required)
const textureId = `signatureTexture_${node.id}`
```

### 4. Polling Optimization

```typescript
// Only regenerate if graph actually changed
if (graph.lastUpdated !== this.lastGraphUpdate) {
  // Regenerate
}
```

### 5. Animation Loop

```typescript
// 60 FPS render loop (standard browsers)
engine.runRenderLoop(() => {
  scene.render()
})
```

## Testing Architecture

### Unit Tests

- **CodeParser**: Regex pattern matching
- **counter**: DOM manipulation
- **Tests**: 100+ unit test cases

### Integration Tests

- **VRSceneManager**: Scene creation with mocked Babylon.js
- **ForceDirectedLayout**: Full physics simulation
- **FileWatcher**: File system integration

### Mocking Strategy

```typescript
// Babylon.js is mocked to avoid WebGL requirement
vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(() => mockEngine),
  Scene: vi.fn(() => mockScene),
  Vector3: vi.fn((x, y, z) => ({ x, y, z })),
  // ... all dependencies
}))
```

Enables:

- Fast test execution (<5 seconds)
- No graphics hardware needed
- CI/CD compatibility
- Predictable behavior

## Scalability Considerations

### Current Limits

- **Nodes**: 65 (extracted from single file)
- **Edges**: 6 (function calls)
- **Graph generation**: <100ms
- **Mesh creation**: <200ms
- **Render frame**: 16.67ms (60 FPS)

### Scaling to Larger Codebases

- **Option 1: Module-Based Visualization** - Parse each module separately, show inter-module calls only, reduce node count to 50-100
- **Option 2: Hierarchical Clustering** - Group functions by module/class, first level shows modules, drill-down to function level
- **Option 3: Time-Windowed Loading** - Load functions in batches, show loading indicator, progressive rendering
- **Option 4: Server-Side Graph Calculation** - Pre-calculate all graphs on build, send compressed graph.json, browser just renders

## Error Handling

### Graceful Degradation

```typescript
// Graph load fails
if (graph === null) {
  console.warn('Could not load graph')
  // Show empty scene, not crash
}

// Parse error in CodeParser
if (error) {
  console.error('Parse error:', error)
  return previousGraph    // Fall back to last good graph
}

// WebXR unavailable
try {
  await scene.createDefaultXRExperienceAsync()
} catch (error) {
  console.warn('WebXR not available')
  // Continue with regular 3D view
}
```

### Error Boundaries

- Constructor errors: Logged, don't crash app
- Graph load errors: Silent fail, show empty scene
- Parse errors: Continue with previous graph
- Render errors: Browser console only

## Security Considerations

### Non-Applicable

- No user input beyond file system
- No network requests beyond fetch graph.json
- No eval() or dynamic code execution
- TypeScript types prevent many injection attacks

### Best Practices Applied

- No innerHTML from user input
- Regex patterns are static (not user input)
- CORS enabled for GitHub Pages domain
- No localStorage/sessionStorage used

## Future Improvements

### Short Term (1-2 weeks)

- [ ] Variable and external module signatures
- [ ] Search/filter by node type
- [ ] UI panel for node details
- [ ] Keyboard shortcuts (F: focus, E: export, etc.)

### Medium Term (1-2 months)

- [ ] Multi-file visualization
- [ ] Call stack visualization
- [ ] Performance profiling overlay
- [ ] Custom color schemes
- [ ] VR hand controller support

### Long Term (3+ months)

- [ ] Large codebase handling (100+ files)
- [ ] AST-based parsing for accuracy
- [ ] Dependency graph overlays
- [ ] Real-time test coverage visualization
- [ ] Mobile/touch gesture support
