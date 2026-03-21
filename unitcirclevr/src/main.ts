import './style.css'
import { VRSceneManager } from './VRSceneManager'

// Log build version timestamp
async function logBuildVersion(): Promise<void> {
  try {
    const response = await fetch('/unitcircle/version.json');
    if (response.ok) {
      const version = await response.json();
      const date = new Date(version.buildTime);
      const formattedTime = date.toLocaleString();
      console.log(`%c📦 Build: ${formattedTime}`, 'color: #00ff00; font-weight: bold; font-size: 12px;');
    }
  } catch (error) {
    // Silent fail if version file not found
  }
}

// Initialize the VR scene
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
if (!canvas) {
  throw new Error('Canvas element not found')
}

logBuildVersion();

const vrScene = new VRSceneManager(canvas)
vrScene.run()

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  vrScene.dispose()
})
