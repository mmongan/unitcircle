# Babylon.js WebXR VR Project

A TypeScript-based virtual reality application built with Babylon.js and WebXR, created with Vite for optimal development and build performance.

## Features

- **3D Graphics**: Babylon.js for powerful 3D rendering
- **WebXR Support**: Ready for VR headsets and immersive experiences
- **TypeScript**: Full type safety and modern JavaScript features
- **Vite Build System**: Fast development server and optimized production builds

## Project Structure

```
src/
├── main.ts              # Application entry point
├── VRSceneManager.ts    # VR scene setup and management
└── style.css            # Global styling
```

## Getting Started

### Prerequisites

- Node.js 16+ and npm

### Installation

1. Install dependencies:

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173/`

## Building for Production

Create an optimized build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deployment to GitHub Pages

This project is configured for automatic deployment to GitHub Pages at `https://mmongan.github.io/unitcircle`

### Prerequisites

Ensure your GitHub repository is properly configured:
1. Repository must be public
2. Ensure you have git credentials configured

### Deploy

Deploy to GitHub Pages with a single command:

```bash
npm run deploy
```

This command will:
1. Build the project with the correct base path (`/unitcircle/`)
2. Push the compiled files to the `gh-pages` branch
3. GitHub Pages will automatically serve the application

### Verify Deployment

After running `npm run deploy`:
1. Go to your repository settings on GitHub
2. Scroll to "GitHub Pages" section
3. Verify it shows "Your site is live at `https://mmongan.github.io/unitcircle`"

The application should be accessible within a few minutes of deployment.

## VR Features

The application includes:

- **3D Scene**: Ground plane with multiple 3D objects
- **Lighting**: Hemispherical and point lighting for realistic rendering
- **WebXR Integration**: Ready for VR headset support (when available in the browser)
- **Interactive Camera**: Orbit controls for non-VR viewing

## Technologies

- **Babylon.js Core** (@babylonjs/core) - 3D engine
- **Babylon.js Loaders** (@babylonjs/loaders) - Load 3D models
- **TypeScript** - Type-safe development
- **Vite** - Modern build tooling

## License

MIT
