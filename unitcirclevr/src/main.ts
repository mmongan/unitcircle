import './style.css'
import { VRSceneManager } from './VRSceneManager'
import '@babylonjs/loaders/glTF'

const LOADING_OVERLAY_ID = 'startupLoadingOverlay';
const LOADING_OVERLAY_MIN_VISIBLE_MS = 1200;
let loadingOverlayShownAt = 0;

// Log build version timestamp
async function logBuildVersion(): Promise<void> {
  try {
    const baseUrl = import.meta.env.BASE_URL;
    const response = await fetch(`${baseUrl}version.json`);
    if (response?.ok) {
      const version = await response.json();
      const date = new Date(version.buildTime);
      logFormattedMessage(date);
    }
  } catch (error) {
    // Silent fail if version file not found
  }
}

function logFormattedMessage(date: Date): void {
  const formattedTime = date.toLocaleString();
  console.log(`%c📦 Build: ${formattedTime}`, 'color: #00ff00; font-weight: bold; font-size: 12px;');
}

function initializeScene(): void {
  showLoadingOverlay();
  const canvas = getCanvasElement();
  void initializeApplication(canvas);
}

function getCanvasElement(): HTMLCanvasElement {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element not found');
  }
  return canvas;
}

async function initializeApplication(canvas: HTMLCanvasElement): Promise<void> {
  if (!isWebGLSupported(canvas)) {
    hideLoadingOverlay(true);
    showUnsupportedMessage(canvas);
    return;
  }

  try {
    await logBuildVersion();
    await createVRScene(canvas);
    setupWindowCleanup();
  } catch (error) {
    console.error('Failed to initialize VR scene:', error);
    showUnsupportedMessage(canvas);
  }
}

async function createVRScene(canvas: HTMLCanvasElement): Promise<void> {
  const vrScene = new VRSceneManager(canvas);
  await runVRScene(vrScene);
}

async function runVRScene(vrScene: VRSceneManager): Promise<void> {
  // Initialize the scene visualization before starting render loop
  await vrScene.initialize();
  setupLayoutRebuildShortcut(vrScene);
  vrScene.run();
  hideLoadingOverlay();
}

function setupLayoutRebuildShortcut(vrScene: VRSceneManager): void {
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    // Press 'R' to rebuild exported function layout
    if (event.key.toLowerCase() === 'r' && event.ctrlKey) {
      event.preventDefault();
      console.log('🔄 Rebuilding exported function layout (Ctrl+R)...');
      vrScene.rebuildExportedFunctionLayout();
    }
  });
}



function setupWindowCleanup(): void {
  window.addEventListener('beforeunload', () => {
    // Cleanup placeholder
  });
}

function isWebGLSupported(canvas: HTMLCanvasElement): boolean {
  if (typeof window === 'undefined' || !('WebGLRenderingContext' in window)) {
    return false;
  }

  const contextNames = ['webgl2', 'webgl', 'experimental-webgl'] as const;
  return contextNames.some((contextName) => {
    const context = canvas.getContext(contextName);
    return context !== null;
  });
}

function showUnsupportedMessage(canvas: HTMLCanvasElement): void {
  canvas.style.display = 'none';
  hideLoadingOverlay(true);
  const existing = document.getElementById('webglUnsupportedMessage');
  if (existing) {
    return;
  }

  const container = document.createElement('div');
  container.id = 'webglUnsupportedMessage';
  container.className = 'webgl-unsupported';
  container.innerHTML = [
    '<h1>WebGL is not available</h1>',
    '<p>This app requires WebGL to render the VR scene.</p>',
    '<p>Try enabling hardware acceleration or using a WebGL-capable browser.</p>',
  ].join('');
  document.body.appendChild(container);
}

function showLoadingOverlay(): void {
  loadingOverlayShownAt = performance.now();
  const existing = document.getElementById(LOADING_OVERLAY_ID);
  if (existing) {
    existing.classList.remove('is-hidden');
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = LOADING_OVERLAY_ID;
  overlay.className = 'startup-loading';
  overlay.innerHTML = [
    '<div class="startup-loading__content">',
    '<div class="startup-loading__title">imagining<span class="startup-loading__dots" aria-hidden="true"></span></div>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);
}

function hideLoadingOverlay(removeImmediately: boolean = false): void {
  const overlay = document.getElementById(LOADING_OVERLAY_ID);
  if (!overlay) {
    return;
  }

  if (removeImmediately) {
    overlay.remove();
    return;
  }

  const elapsedMs = performance.now() - loadingOverlayShownAt;
  const delayMs = Math.max(0, LOADING_OVERLAY_MIN_VISIBLE_MS - elapsedMs);

  window.setTimeout(() => {
    overlay.classList.add('is-hidden');
    window.setTimeout(() => {
      overlay.remove();
    }, 450);
  }, delayMs);
}

initializeScene();
