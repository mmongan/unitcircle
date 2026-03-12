import './style.css'
import { VRSceneManager } from './VRSceneManager'

// Initialize the VR scene
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
if (!canvas) {
  throw new Error('Canvas element not found')
}

const vrScene = new VRSceneManager(canvas)
vrScene.run()

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  vrScene.dispose()
})
