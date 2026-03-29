# Orphaned Edges Investigation & Fix

## Issue
"There are edges pointing at nothing" - edges in the graph that reference nodes that don't exist.

## Investigation Results

### Current State
- **Graph nodes**: 955
- **Graph edges**: 1,358  
- **Invalid edges**: 0 (in current graph.json)

The current graph has no orphaned edges in the static data. However, orphaned edges *could* be created during graph generation due to:

### Root Causes
1. **Unresolved references**: When the code parser creates edges for function calls, type references, or imports, it resolves the target symbol. If the target isn't found or gets filtered out during graph generation, orphaned edges could result.

2. **Multi-pass generation**: The graph is built in 4 passes:
   - Pass 1: Extract declarations (functions, classes, interfaces, etc.)
   - Pass 2: Extract function calls
   - Pass 3: Add HTML entry nodes
   - Pass 4: Emit import/export graph

   If a reference is resolved in Pass 2 but the target node is later removed, the edge becomes orphaned.

3. **Module anchorsnodes**: For each file, a module anchor node is created. Edges might reference anchors that don't make it into the final node set.

## Fix Implemented

### CodeTreeBuilder.ts - Edge Validation Pass
Added a validation pass at the end of the `build()` method that:

1. **Creates a set of all valid node IDs** from the final nodes array
2. **Filters edges** to only include those where both `from` and `to` nodes exist
3. **Logs statistics** about filtered edges for debugging

### Code Added (lines 279-311)
```typescript
// Validate edges: filter out any edges that reference non-existent nodes
const nodeIds = new Set(nodes.map(n => n.id));
const validEdges: typeof this.calls = [];
const invalidEdges: Array<{ edge: typeof this.calls[0]; reason: string }> = [];

for (const edge of this.calls) {
  const fromExists = nodeIds.has(edge.from);
  const toExists = nodeIds.has(edge.to);

  if (!fromExists || !toExists) {
    const reason = !fromExists && !toExists
      ? 'both endpoints missing'
      : !fromExists
        ? `source missing: ${edge.from}`
        : `target missing: ${edge.to}`;
    invalidEdges.push({ edge, reason });
  } else {
    validEdges.push(edge);
  }
}

if (invalidEdges.length > 0) {
  console.warn(`⚠️  Filtered out ${invalidEdges.length} edges with missing node endpoints:`);
  // Show first 5 invalid edges as examples
  for (const { edge, reason } of invalidEdges.slice(0, 5)) {
    console.warn(`   • ${edge.from} → ${edge.to} (${reason})`);
  }
  if (invalidEdges.length > 5) {
    console.warn(`   ... and ${invalidEdges.length - 5} more`);
  }
}
```

## Runtime Protection

VRSceneManager already has runtime validation (line 1742) that filters any remaining orphaned edges:

```typescript
for (const edge of graph.edges) {
  // Validate both endpoints exist
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
    invalidEdgeCount++;
    if (invalidEdgeCount <= 10) {
      console.warn(`⚠️ Edge references missing node: ${edge.from} → ${edge.to}`);
    }
    continue;  // Skip edges with missing endpoints
  }
  // ... process valid edge
}
```

This provides defense-in-depth: edges are now prevented at build time AND filtered at runtime.

## Next Steps
- Monitor console output when running `npm run graph:build` for any warnings about filtered edges
- If warnings appear, they will show which nodes are being referenced but missing, helping identify edge case bugs in the parser
- The presence of 0 invalid edges suggests the parser is working well currently
