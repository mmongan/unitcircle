export function normalizePath(path: string): string {
  return path.replace(/\\+/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

export function toProjectRelativePath(path: string): string {
  const normalized = normalizePath(path);

  const projectMarker = '/unitcirclevr/';
  const markerIndex = normalized.toLowerCase().indexOf(projectMarker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + projectMarker.length);
  }

  if (normalized.startsWith('/')) {
    return normalized.slice(1);
  }

  return normalized;
}

export function getDirectoryPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split('/');
  if (parts.length <= 1) {
    return '';
  }
  return parts.slice(0, -1).join('/');
}

export function getParentDirectoryPath(dirPath: string): string {
  const normalized = normalizePath(dirPath);
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/');
  if (parts.length <= 1) {
    return '';
  }
  return parts.slice(0, -1).join('/');
}
