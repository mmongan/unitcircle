#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, '../dist');
const githubPagesDir = path.resolve(__dirname, '../../mmongan.github.io');

console.log('Deploying to GitHub Pages...');
console.log(`Source: ${distDir}`);
console.log(`Target: ${githubPagesDir}`);

// Check if directories exist
if (!fs.existsSync(distDir)) {
  console.error(`✗ Source directory not found: ${distDir}`);
  process.exit(1);
}

if (!fs.existsSync(githubPagesDir)) {
  console.error(`✗ Target directory not found: ${githubPagesDir}`);
  console.error('Please clone https://github.com/mmongan/mmongan.github.io to', githubPagesDir);
  process.exit(1);
}

// Copy dist files to mmongan.github.io using fs.cpSync
try {
  console.log('Copying files from dist to mmongan.github.io...');
  fs.cpSync(distDir, githubPagesDir, { recursive: true, force: true });
  
  console.log('✓ Files copied successfully');

  // Verify copy worked
  const indexExists = fs.existsSync(path.join(githubPagesDir, 'index.html'));
  if (!indexExists) {
    console.error('✗ index.html not found in target - copy may have failed');
    process.exit(1);
  }
  
  console.log('✓ Verified index.html exists in target');

  // Commit and push
  const cwd = githubPagesDir;
  
  console.log('Running git operations...');
  
  // Ensure we're on the main branch (GitHub Pages for user sites)
  try {
    execSync('git fetch origin', { cwd });
    execSync('git checkout main', { cwd });
    execSync('git reset --hard origin/main', { cwd });
  } catch (e) {
    console.log('ℹ Could not sync with remote, continuing...');
  }
  
  execSync('git add -A', { cwd });
  console.log('✓ Files staged for commit');
  
  try {
    execSync('git commit -m "Deploy: Update site with latest build"', { cwd });
    console.log('✓ Changes committed');
  } catch (commitError) {
    // No changes to commit is fine
    if (commitError.message.includes('nothing to commit')) {
      console.log('ℹ No changes to commit');
    } else {
      throw commitError;
    }
  }
  
  execSync('git push origin main', { cwd });
  console.log('✓ Changes pushed to GitHub Pages');
  
  console.log('\n✓ Deployment complete!');
  process.exit(0);
} catch (error) {
  console.error('\n✗ Deployment failed:', error.message);
  if (error.stderr) console.error('STDERR:', error.stderr.toString());
  if (error.stdout) console.error('STDOUT:', error.stdout.toString());
  process.exit(1);
}
