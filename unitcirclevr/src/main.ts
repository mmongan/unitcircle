import './style.css'
import { VRSceneManager } from './VRSceneManager'

// Log build version timestamp
async function logBuildVersion(): Promise<void> {
  try {
    const response = await fetch('/unitcircle/version.json');
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
  const canvas = getCanvasElement();
  initializeApplication(canvas);
}

function getCanvasElement(): HTMLCanvasElement {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element not found');
  }
  return canvas;
}

async function initializeApplication(canvas: HTMLCanvasElement): Promise<void> {
  await logBuildVersion();
  createVRScene(canvas);
  setupWindowCleanup();
}

function createVRScene(canvas: HTMLCanvasElement): void {
  const vrScene = new VRSceneManager(canvas);
  runVRScene(vrScene);
}

async function runVRScene(vrScene: VRSceneManager): Promise<void> {
  // Initialize the scene visualization before starting render loop
  await vrScene.initialize();
  vrScene.run();
}

function setupWindowCleanup(): void {
  window.addEventListener('beforeunload', () => {
    // Cleanup placeholder
  });
}

initializeScene();
