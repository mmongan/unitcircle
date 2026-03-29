import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  toProjectRelativePath,
  getDirectoryPath,
  getParentDirectoryPath,
} from '../../src/PathUtils';

describe('PathUtils', () => {
  describe('normalizePath', () => {
    it('converts backslashes to forward slashes', () => {
      expect(normalizePath('src\\utils\\helpers.ts')).toBe('src/utils/helpers.ts');
    });

    it('removes leading ./', () => {
      expect(normalizePath('./src/utils')).toBe('src/utils');
    });

    it('removes trailing slash', () => {
      expect(normalizePath('src/utils/')).toBe('src/utils');
    });

    it('collapses double forward slashes', () => {
      expect(normalizePath('src//utils')).toBe('src/utils');
    });

    it('handles a plain filename unchanged', () => {
      expect(normalizePath('file.ts')).toBe('file.ts');
    });

    it('handles multiple consecutive backslashes', () => {
      expect(normalizePath('src\\\\utils\\\\file.ts')).toBe('src/utils/file.ts');
    });

    it('handles mixed slash types', () => {
      expect(normalizePath('src\\utils/file.ts')).toBe('src/utils/file.ts');
    });

    it('returns empty string for empty input', () => {
      expect(normalizePath('')).toBe('');
    });

    it('does not alter an already normalized path', () => {
      expect(normalizePath('src/utils/file.ts')).toBe('src/utils/file.ts');
    });
  });

  describe('toProjectRelativePath', () => {
    it('strips the /unitcirclevr/ project marker', () => {
      expect(toProjectRelativePath('/projects/unitcirclevr/src/main.ts')).toBe('src/main.ts');
    });

    it('is case-insensitive when matching project marker', () => {
      expect(toProjectRelativePath('/PROJECTS/UNITCIRCLEVR/src/main.ts')).toBe('src/main.ts');
    });

    it('strips leading slash from absolute paths without marker', () => {
      expect(toProjectRelativePath('/src/main.ts')).toBe('src/main.ts');
    });

    it('leaves already relative paths unchanged', () => {
      expect(toProjectRelativePath('src/main.ts')).toBe('src/main.ts');
    });

    it('normalizes backslashes before stripping marker', () => {
      expect(toProjectRelativePath('C:\\projects\\unitcirclevr\\src\\main.ts')).toBe(
        'src/main.ts',
      );
    });

    it('handles path that is just the project root (trailing slash stripped before marker check)', () => {
      // normalizePath removes the trailing slash, so "/unitcirclevr/" marker isn't found.
      // The function falls back to stripping the leading slash instead.
      expect(toProjectRelativePath('/projects/unitcirclevr/')).toBe('projects/unitcirclevr');
    });
  });

  describe('getDirectoryPath', () => {
    it('returns the directory portion of a file path', () => {
      expect(getDirectoryPath('src/utils/helpers.ts')).toBe('src/utils');
    });

    it('returns empty string for a root-level file', () => {
      expect(getDirectoryPath('helpers.ts')).toBe('');
    });

    it('handles deeply nested path', () => {
      expect(getDirectoryPath('src/a/b/c.ts')).toBe('src/a/b');
    });

    it('normalizes backslashes before extracting directory', () => {
      expect(getDirectoryPath('src\\utils\\helpers.ts')).toBe('src/utils');
    });

    it('strips trailing slash then returns directory', () => {
      expect(getDirectoryPath('src/utils/')).toBe('src');
    });
  });

  describe('getParentDirectoryPath', () => {
    it('returns the parent of a directory', () => {
      expect(getParentDirectoryPath('src/utils')).toBe('src');
    });

    it('returns empty string for a top-level directory', () => {
      expect(getParentDirectoryPath('src')).toBe('');
    });

    it('returns empty string for an empty string', () => {
      expect(getParentDirectoryPath('')).toBe('');
    });

    it('handles deeply nested path', () => {
      expect(getParentDirectoryPath('src/a/b')).toBe('src/a');
    });

    it('normalizes trailing slash before computing parent', () => {
      expect(getParentDirectoryPath('src/utils/')).toBe('src');
    });

    it('normalizes backslashes before computing parent', () => {
      expect(getParentDirectoryPath('src\\utils')).toBe('src');
    });
  });
});
