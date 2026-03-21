/**
 * Scene configuration and color constants
 */
import * as BABYLON from '@babylonjs/core';

export class SceneConfig {
  // Node Colors
  static readonly EXPORTED_FUNCTION_COLOR = new BABYLON.Color3(0.2, 1, 0.8);
  static readonly LEAF_FUNCTION_COLOR = new BABYLON.Color3(0.8, 0.8, 0.8);
  static readonly CALLED_FUNCTION_COLORS = [
    new BABYLON.Color3(1, 0.2, 0.2),
    new BABYLON.Color3(0.2, 1, 0.2),
    new BABYLON.Color3(0.2, 0.2, 1),
    new BABYLON.Color3(1, 1, 0.2),
    new BABYLON.Color3(1, 0.2, 1),
  ];

  static readonly EXPORTED_VARIABLE_COLOR = new BABYLON.Color3(1, 0.8, 0.2);
  static readonly INTERNAL_VARIABLE_COLOR = new BABYLON.Color3(0.6, 0.6, 0.6);
  static readonly EXTERNAL_MODULE_COLOR = new BABYLON.Color3(0.4, 0.8, 1);

  // Interaction Colors
  static readonly HOVER_COLOR = new BABYLON.Color3(1, 1, 1);
  static readonly EDGE_COLOR = new BABYLON.Color3(0.5, 0.5, 0.5);
  static readonly GROUND_COLOR = new BABYLON.Color3(0.2, 0.7, 0.2);

  // Node Dimensions
  static readonly FUNCTION_BOX_SIZE = 2.0;
  static readonly VARIABLE_SPHERE_DIAMETER = 1.5;
  static readonly EXTERNAL_CYLINDER_DIAMETER = 1.2;
  static readonly EXTERNAL_CYLINDER_HEIGHT = 2.0;

  // Lighting
  static readonly LIGHT_INTENSITY = 0.7;
  static readonly POINT_LIGHT_INTENSITY = 0.5;
  static readonly POINT_LIGHT_POSITION = new BABYLON.Vector3(5, 10, 5);

  // Camera
  static readonly CAMERA_POSITION = new BABYLON.Vector3(0, 0, -70);
  static readonly CAMERA_INERTIA = 0.5;
  static readonly CAMERA_ANGULAR_SENSIBILITY = 1000;

  // Ground
  static readonly GROUND_WIDTH = 150;
  static readonly GROUND_HEIGHT = 150;

  // Label
  static readonly LABEL_OFFSET = new BABYLON.Vector3(0, 1.2, 0);
  static readonly LABEL_WIDTH = 2;
  static readonly LABEL_HEIGHT = 0.5;
  static readonly LABEL_TEXTURE_SIZE = 512;

  // Texture
  static readonly SIGNATURE_TEXTURE_SIZE = 512;
  static readonly SIGNATURE_TEXTURE_BORDER_SIZE = 10;
  static readonly SIGNATURE_FONT_SIZE_PX = 32;
  static readonly SIGNATURE_FONT_FAMILY = 'monospace';
  static readonly SIGNATURE_TEXT_COLOR = '#00ff00';
  static readonly SIGNATURE_BORDER_COLOR = '#00ff00';

  // Edge Rendering
  static readonly EDGE_RADIUS = 0.2;

  // Physics Layout
  static readonly LAYOUT_ITERATIONS = 100;

  // Animation
  static readonly FLY_TO_ANIMATION_TIME_MS = 800;
  static readonly FLY_TO_ANIMATION_FPS = 60;
  static readonly FLY_TO_OFFSET = new BABYLON.Vector3(0, 0, -5);

  // Polling
  static readonly GRAPH_POLL_INTERVAL_MS = 2000;
}
