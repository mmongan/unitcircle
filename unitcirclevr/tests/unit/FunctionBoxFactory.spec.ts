import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FunctionBoxFactory } from '../../src/FunctionBoxFactory';
import type {
  FunctionBoxFactoryConfig,
  FunctionBoxRenderAdapter,
} from '../../src/FunctionBoxContracts';

vi.mock('@babylonjs/core', () => ({
  Material: { MATERIAL_OPAQUE: 1 },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<FunctionBoxFactoryConfig> = {}): FunctionBoxFactoryConfig {
  return {
    exportedFunctionBoxSize: 8,
    internalFunctionBoxSize: 5,
    functionBoxSize: 4,
    signatureTextureSize: 128,
    signatureFontFamily: 'monospace',
    ...overrides,
  };
}

function makeCtx() {
  return {
    clearRect: vi.fn(),
    fillStyle: '',
    fillRect: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    strokeRect: vi.fn(),
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
  };
}

function makeMockAdapter(): FunctionBoxRenderAdapter & { _box: any; _material: any } {
  const ctx = makeCtx();

  const mockTexture: any = {
    hasAlpha: true,
    getContext: vi.fn(() => ctx),
    update: vi.fn(),
  };

  const mockBox: any = {
    position: { x: 0, y: 0, z: 0 },
    isPickable: false,
    isVisible: false,
    material: null,
    setEnabled: vi.fn(),
  };

  const mockMaterial: any = {
    diffuseColor: null,
    emissiveColor: null,
    specularColor: null,
    specularPower: null,
    wireframe: null,
    alpha: null,
    transparencyMode: null,
    disableLighting: null,
    diffuseTexture: null,
  };

  const adapter: any = {
    _box: mockBox,
    _material: mockMaterial,
    createBox: vi.fn(() => mockBox),
    createMaterial: vi.fn(() => mockMaterial),
    createDynamicTexture: vi.fn(() => mockTexture),
    createColor3: vi.fn((r: number, g: number, b: number) => ({ r, g, b })),
    createVector4: vi.fn((x: number, y: number, z: number, w: number) => ({ x, y, z, w })),
  };

  return adapter;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FunctionBoxFactory', () => {
  let adapter: ReturnType<typeof makeMockAdapter>;
  let factory: FunctionBoxFactory;

  beforeEach(() => {
    adapter = makeMockAdapter();
    factory = new FunctionBoxFactory(makeConfig(), adapter);
  });

  // ── Box size ───────────────────────────────────────────────────────────────

  describe('box size selection', () => {
    it('uses exportedFunctionBoxSize for exported nodes', () => {
      factory.create({ id: 'a', name: 'fn', isExported: true }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter.createBox).toHaveBeenCalledWith('func_a', 8, expect.any(Array));
    });

    it('uses internalFunctionBoxSize for non-exported nodes', () => {
      factory.create({ id: 'b', name: 'fn', isExported: false }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter.createBox).toHaveBeenCalledWith('func_b', 5, expect.any(Array));
    });

    it('uses functionBoxSize as the minimum (exported)', () => {
      factory = new FunctionBoxFactory(
        makeConfig({ exportedFunctionBoxSize: 2, functionBoxSize: 10 }),
        adapter,
      );
      factory.create({ id: 'c', name: 'fn', isExported: true }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter.createBox).toHaveBeenCalledWith('func_c', 10, expect.any(Array));
    });

    it('uses functionBoxSize as the minimum (internal)', () => {
      factory = new FunctionBoxFactory(
        makeConfig({ internalFunctionBoxSize: 1, functionBoxSize: 6 }),
        adapter,
      );
      factory.create({ id: 'd', name: 'fn', isExported: false }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter.createBox).toHaveBeenCalledWith('func_d', 6, expect.any(Array));
    });

    it('stores boxSize on the mesh object', () => {
      factory.create({ id: 'a', name: 'fn', isExported: true }, { x: 0, y: 0, z: 0 }, null);
      expect((adapter._box as any).boxSize).toBe(8);
    });
  });

  // ── Position ───────────────────────────────────────────────────────────────

  describe('mesh position', () => {
    it('sets x, y, z via direct property assignment', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 3, y: 7, z: -2 }, null);
      expect(adapter._box.position.x).toBe(3);
      expect(adapter._box.position.y).toBe(7);
      expect(adapter._box.position.z).toBe(-2);
    });

    it('sets position via copyFromFloats when available', () => {
      const copyFromFloats = vi.fn();
      adapter._box.position = { x: 0, y: 0, z: 0, copyFromFloats };
      factory.create({ id: 'a', name: 'fn' }, { x: 1, y: 2, z: 3 }, null);
      expect(copyFromFloats).toHaveBeenCalledWith(1, 2, 3);
    });
  });

  // ── Material naming ────────────────────────────────────────────────────────

  describe('material creation', () => {
    it('creates material with the node id in its name', () => {
      factory.create({ id: 'xyz', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter.createMaterial).toHaveBeenCalledWith('mat_xyz');
    });

    it('sets diffuseColor to white (1,1,1)', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter._material.diffuseColor).toEqual({ r: 1, g: 1, b: 1 });
    });

    it('sets specularPower to 16', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter._material.specularPower).toBe(16);
    });

    it('wireframe is false', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter._material.wireframe).toBe(false);
    });
  });

  // ── Emissive tint ──────────────────────────────────────────────────────────

  describe('emissive color', () => {
    it('uses file-color-derived emissive when fileColor is provided (non-exported)', () => {
      factory.create(
        { id: 'a', name: 'fn', isExported: false },
        { x: 0, y: 0, z: 0 },
        { r: 1, g: 0, b: 0 },
      );
      // Expected call: emissiveColor = { r: 0.08+1*0.10, g: 0.08+0*0.10, b: 0.08+0*0.10 }
      const calls = (adapter.createColor3 as ReturnType<typeof vi.fn>).mock.calls;
      const emissive = calls.find(
        ([r, g, b]: number[]) => Math.abs(r - 0.18) < 0.001 && Math.abs(g - 0.08) < 0.001,
      );
      expect(emissive).toBeDefined();
    });

    it('uses fixed grey emissive when fileColor is null (non-exported)', () => {
      factory.create({ id: 'a', name: 'fn', isExported: false }, { x: 0, y: 0, z: 0 }, null);
      const calls = (adapter.createColor3 as ReturnType<typeof vi.fn>).mock.calls;
      const grey = calls.find(([r, g, b]: number[]) => r === 0.12 && g === 0.12 && b === 0.12);
      expect(grey).toBeDefined();
    });

    it('uses fixed emissive (0.22,0.22,0.22) for exported nodes', () => {
      factory.create({ id: 'a', name: 'fn', isExported: true }, { x: 0, y: 0, z: 0 }, null);
      const calls = (adapter.createColor3 as ReturnType<typeof vi.fn>).mock.calls;
      const exported = calls.find(([r, g, b]: number[]) => r === 0.22 && g === 0.22 && b === 0.22);
      expect(exported).toBeDefined();
    });
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  describe('mesh visibility', () => {
    it('sets isPickable = true', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter._box.isPickable).toBe(true);
    });

    it('calls setEnabled(true) on the mesh', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter._box.setEnabled).toHaveBeenCalledWith(true);
    });
  });

  // ── Texture atlas ─────────────────────────────────────────────────────────

  describe('texture atlas', () => {
    it('creates a dynamic texture for each node', () => {
      factory.create({ id: 'a', name: 'myFunc' }, { x: 0, y: 0, z: 0 }, null);
      expect(adapter.createDynamicTexture).toHaveBeenCalledWith(
        'signatureTexture_a',
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('passes exactly 6 face UVs to createBox', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      const uvs = (adapter.createBox as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(uvs).toHaveLength(6);
    });

    it('attaches the texture as the material diffuse texture', () => {
      factory.create({ id: 'a', name: 'fn' }, { x: 0, y: 0, z: 0 }, null);
      // diffuseTexture should be set to the texture returned by createDynamicTexture
      expect(adapter._material.diffuseTexture).toBeDefined();
    });
  });

  // ── Return value ──────────────────────────────────────────────────────────

  describe('return value', () => {
    it('returns a mesh and a material', () => {
      const { mesh, material } = factory.create(
        { id: 'a', name: 'fn' },
        { x: 0, y: 0, z: 0 },
        null,
      );
      expect(mesh).toBeDefined();
      expect(material).toBeDefined();
    });

    it('returned mesh has the material assigned', () => {
      const { mesh, material } = factory.create(
        { id: 'a', name: 'fn' },
        { x: 0, y: 0, z: 0 },
        null,
      );
      expect(mesh.material).toBe(material);
    });
  });
});
