# Contributing to Unit Circle VR

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/mmongan/unitcircle.git
cd unitcircle/unitcirclevr
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Server

```bash
npm run dev:watch
```

This starts both:

- File watcher (regenerates graph.json on code changes)
- [Vite dev server](http://localhost:5173)

## Workflow

### Making Changes

1. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** in `src/`

3. **Watch the visualization update** in real-time via dev server

4. **Write tests** in `tests/unit/`
   - Match file structure: `src/Foo.ts` → `tests/unit/Foo.spec.ts`
   - Follow existing test style

5. **Run tests**:

   ```bash
   npm test -- --watch
   ```

6. **Check coverage**:

   ```bash
   npm test -- --coverage
   ```

7. **Verify build**:

   ```bash
   npm run build
   ```

8. **Commit with descriptive message**:

   ```bash
   git add -A
   git commit -m "Add feature: description of changes"
   ```

9. **Push and create Pull Request**:

   ```bash
   git push origin feature/your-feature-name
   ```

## Code Standards

### TypeScript

- **Target**: ES2020 (TypeScript 5.9+)
- **Strict Mode**: Enabled (use strict type checking)
- **No `any` types**: Use proper types or generics
- **Docstrings**: Add comments for complex logic

**Example**:

```typescript
/** Generates a dynamic texture with function metadata */
private createSignatureTexture(node: GraphData['nodes'][0]): BABYLON.DynamicTexture {
  const textureSize = 512
  const dynamicTexture = new BABYLON.DynamicTexture(
    `signatureTexture_${node.id}`,
    textureSize,
    this.scene
  )
  // Implementation
  return dynamicTexture
}
```

### Formatting

- **Line Length**: 100 characters (soft limit)
- **Indentation**: 2 spaces
- **Semicolons**: Required
- **Quotes**: Single quotes for strings
- **Naming**:
  - Classes: PascalCase (`VRSceneManager`)
  - Functions/methods: camelCase (`createFunctionMesh`)
  - Constants: UPPER_SNAKE_CASE (`MAX_ITERATIONS`)
  - Private members: `_leadingUnderscore`

## Testing Standards

### Test Structure

Every feature needs tests. Follow this structure:

```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do X when Y happens', () => {
      // Arrange
      const input = createTestInput()
      
      // Act
      const result = component.method(input)
      
      // Assert
      expect(result).toBe(expected)
    })
    
    it('should handle error case Z', () => {
      // Test error paths
    })
  })
})
```

### Coverage Requirements

- **New code**: Minimum 80% coverage
- **Modified code**: Maintain or improve coverage
- **Critical paths**: 90%+ coverage

### Running Tests

```bash
# Run all tests
npm test

# Watch mode (recommended during development)
npm test -- --watch

# Run specific file
npm test -- CodeParser.spec.ts

# Run tests matching pattern
npm test -- -t "should extract functions"

# Check coverage
npm test -- --coverage
```

## Commit Messages

Use clear, descriptive commit messages:

```text
# Good
git commit -m "Add VRSceneManager tests with 74 test cases

- Constructor initialization
- Graph loading and validation
- Mesh creation and interaction
- Scene root animation
"

# Also good for simple changes
git commit -m "Fix: correct camera inertia value"

# Avoid
git commit -m "Update"
git commit -m "Fixed bugs"
```

### Commit Message Format

```text
<type>: <subject>

<body (optional)>

<footer (optional)>
```

**Type**: The kind of change

- `feat`: New feature
- `fix`: Bug fix
- `test`: Test additions/updates
- `docs`: Documentation changes
- `refactor`: Code restructuring (no behavior change)
- `style`: Formatting (no logic change)
- `perf`: Performance improvement

**Subject**: Imperative, present tense, no period

- ✅ "Add function call analysis"
- ❌ "Added function call analysis"
- ❌ "Adds function call analysis"

**Body**: Why the change (not what code does)

**Footer**: Reference issues: `Fixes #123`

## Pull Request Process

### Before Submitting

1. **Run full test suite**:

   ```bash
   npm test
   ```

2. **Check TypeScript compilation**:

   ```bash
   npx tsc --noEmit
   ```

3. **Verify build succeeds**:

   ```bash
   npm run build
   ```

4. **Check coverage didn't decrease**:

   ```bash
   npm test -- --coverage
   ```

### PR Description

```markdown
## Description
Brief explanation of what this PR does.

## Type of Change
- [ ] New feature
- [ ] Bug fix
- [ ] Documentation
- [ ] Performance improvement

## Testing
How was this tested?
- [ ] Unit tests added
- [ ] Manual testing
- [ ] Coverage maintained/improved

## Checklist
- [ ] Tests pass locally (`npm test`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Build succeeds (`npm run build`)
- [ ] Commits are well-documented
- [ ] Coverage not decreased

## Related Issues
Fixes #123
```

## Common Tasks

### Add a New Module

1. **Create source file** `src/MyModule.ts`
2. **Create test file** `tests/unit/MyModule.spec.ts`
3. **Write implementation** with proper types
4. **Write tests** for all public methods
5. **Run tests** to verify
6. **Update exports** if needed

### Fix a Bug

1. **Reproduce the bug** first
2. **Create test case** that fails
3. **Fix the bug** in source code
4. **Verify test passes**
5. **Check no regressions** (`npm test`)
6. **Commit with clear message**

### Improve Performance

1. **Measure** current performance
2. **Profile** to find bottleneck
3. **Implement improvement**
4. **Measure again** to verify gain
5. **Add tests** for edge cases
6. **Document** the optimization

### Update Dependencies

1. **Review changelog** for breaking changes
2. **Update `package.json`**
3. **Run `npm install`**
4. **Test thoroughly** (`npm test && npm run build`)
5. **Document** any changes needed

## Architecture Decisions

### When to Make Changes

- **Small fixes**: Direct changes fine
- **New features**: Open issue first for discussion
- **Architecture changes**: Discuss in issue before implementing
- **Large refactors**: Create RFC (Request for Comments)

### Design Principles

1. **VR Safety**: Scene root animates, camera stays fixed
2. **Separation of Concerns**: Each module has single responsibility
3. **Testability**: Code designed to be easily tested
4. **Type Safety**: TypeScript strict mode enforced
5. **Performance**: Avoid unnecessary re-renders/recalculations

## Documentation

### Updating README

The README is the main user documentation. Update when:

- Adding new features
- Changing deployment process
- Adding new commands
- Improving examples

### Updating ARCHITECTURE.md

Update ARCHITECTURE documentation when:

- Significantly changing how modules interact
- Adding new modules
- Changing data structures
- Modifying algorithm approach

### Code Comments

Add comments for:

- Complex algorithms (explain "why")
- Magic numbers (explain intention)
- Non-obvious code patterns
- Workarounds for edge cases

Avoid comments for:

- Self-documenting code
- Obvious logic
- Things that change frequently

## Review Process

### Code Review Checklist

Reviewers check:

- [ ] Tests are comprehensive
- [ ] No TypeScript errors
- [ ] Code follows style guide
- [ ] No breaking changes to API
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] No unnecessary dependencies added

### Getting Your PR Merged

1. Create PR with clear description
2. Ensure CI passes (tests, build, lint)
3. Get approval from maintainer
4. Maintainer merges to `main`
5. Deployed automatically

## Resources

- [**Babylon.js Docs**](https://doc.babylonjs.com/)
- [**Vitest Guide**](https://vitest.dev/)
- [**TypeScript Handbook**](https://www.typescriptlang.org/docs/)
- [**Conventional Commits**](https://www.conventionalcommits.org/)

## Questions?

- Open a GitHub issue
- Ask in PR discussions
- Check existing issues first

## License

By contributing, you agree your code will be licensed under MIT.

---

**Thanks for contributing!** 🚀
