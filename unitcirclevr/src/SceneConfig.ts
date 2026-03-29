/**
 * Scene configuration and color constants
 */
import * as BABYLON from '@babylonjs/core';

export class SceneConfig {
  // Node Colors (reduced brightness to prevent washout)
  static readonly EXPORTED_FUNCTION_COLOR = new BABYLON.Color3(0.15, 0.5, 0.4);
  static readonly LEAF_FUNCTION_COLOR = new BABYLON.Color3(0.4, 0.4, 0.4);
  static readonly CALLED_FUNCTION_COLORS = [
    new BABYLON.Color3(0.10, 0.46, 0.68),
    new BABYLON.Color3(0.12, 0.56, 0.24),
    new BABYLON.Color3(0.18, 0.30, 0.70),
    new BABYLON.Color3(0.10, 0.58, 0.58),
    new BABYLON.Color3(0.40, 0.46, 0.12),
  ];

  static readonly EXPORTED_VARIABLE_COLOR = new BABYLON.Color3(0.5, 0.4, 0.1);
  static readonly INTERNAL_VARIABLE_COLOR = new BABYLON.Color3(0.3, 0.3, 0.3);
  static readonly EXTERNAL_MODULE_COLOR = new BABYLON.Color3(0.2, 0.4, 0.5);

  // Interaction Colors
  static readonly HOVER_COLOR = new BABYLON.Color3(0.4, 0.4, 0.4);
  static readonly EDGE_COLOR = new BABYLON.Color3(0.5, 0.5, 0.5);
  static readonly FILE_BOX_EDGE_COLOR = new BABYLON.Color4(0.08, 0.08, 0.08, 1.0);
  static readonly FILE_BOX_EDGE_WIDTH = 4;
  static readonly GROUND_COLOR = new BABYLON.Color3(0.2, 0.7, 0.2);

  // Node Dimensions
  static readonly FUNCTION_BOX_SIZE = 0.1;
  static readonly INTERNAL_FUNCTION_BOX_SIZE = 2.2;
  static readonly EXPORTED_FUNCTION_BOX_SIZE = 6.0;
  static readonly EXTERNAL_PYRAMID_BASE = 1.2;
  static readonly EXTERNAL_PYRAMID_HEIGHT = 2.0;

  // Lighting
  static readonly LIGHT_INTENSITY = 0.7;
  static readonly POINT_LIGHT_INTENSITY = 0.5;
  static readonly POINT_LIGHT_POSITION = new BABYLON.Vector3(5, 10, 5);

  // Camera
  static readonly CAMERA_POSITION = new BABYLON.Vector3(0, 0, -20);
  static readonly CAMERA_INERTIA = 0.5;
  static readonly CAMERA_ANGULAR_SENSIBILITY = 1000;

  // Ground
  static readonly GROUND_WIDTH = 150;
  static readonly GROUND_HEIGHT = 150;

  // Label
  static readonly LABEL_OFFSET = new BABYLON.Vector3(0, 1.5, 0);
  static readonly LABEL_WIDTH = 4;  // Increased from 2 for better readability
  static readonly LABEL_HEIGHT = 1.2;  // Increased from 0.5 for better readability
  static readonly LABEL_TEXTURE_SIZE = 1024;  // Increased from 512 for sharper text

  // Texture
  static readonly SIGNATURE_TEXTURE_SIZE = 256;
  static readonly SIGNATURE_TEXTURE_BORDER_SIZE = 10;
  static readonly SIGNATURE_FONT_SIZE_PX = 42;
  static readonly SIGNATURE_FONT_FAMILY = 'monospace';
  static readonly SIGNATURE_TEXT_COLOR = '#ffffff';
  static readonly SIGNATURE_BORDER_COLOR = '#ffffff';

  // Edge Rendering
  static readonly ENABLE_EDGE_RENDERING = false;
  static readonly EDGE_RADIUS = 0.2;          // Cross-file / exported edge radius
  static readonly INTERNAL_EDGE_RADIUS = 0.14; // Same-file internal edge radius (boosted for distance readability)

  // Scene decluttering
  static readonly DECLUTTER_FOCUS_VISIBILITY = 1.0;
  static readonly DECLUTTER_CONTEXT_VISIBILITY = 0.7;
  static readonly DECLUTTER_BACKGROUND_VISIBILITY = 0.5;
  static readonly DECLUTTER_HIDDEN_VISIBILITY = 0.0;
  static readonly DECLUTTER_ACTIVE_FILE_BOX_ALPHA = 0.18;
  static readonly DECLUTTER_CONTEXT_FILE_BOX_ALPHA = 0.14;
  static readonly DECLUTTER_BACKGROUND_FILE_BOX_ALPHA = 0.10;
  static readonly DECLUTTER_ACTIVE_DIRECTORY_BOX_ALPHA = 0.12;
  static readonly DECLUTTER_CONTEXT_DIRECTORY_BOX_ALPHA = 0.06;
  static readonly DECLUTTER_MUTATIONS_PER_FRAME = 140;
  static readonly SHOW_DIRECTORY_CAGE = false;
  static readonly STATIC_OBJECT_RENDER = true;

  // Physics Layout
  static readonly LAYOUT_ITERATIONS = 1; // Simple random placement requires minimal iterations

  // Animation
  static readonly FLY_TO_ANIMATION_TIME_MS = 2000;  // Increased from 900ms for dramatic effect
  static readonly FLY_TO_ANIMATION_FPS = 60;
  static readonly FLY_TO_OFFSET = new BABYLON.Vector3(0, 0, 6.5);  // Stay outside cube (size 4.0)
  static readonly AUTO_FOCUS_INDEX_ON_STARTUP = false;

  // Polling
  static readonly ENABLE_GRAPH_POLLING = false;
  static readonly GRAPH_POLL_INTERVAL_MS = 2000;
}
