import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export const ROOT = process.cwd();

export function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

export async function loadRepoMap() {
  const raw = await readFile(resolve(ROOT, 'repo-map.json'), 'utf8');
  return JSON.parse(raw);
}

export function getRepository(repoMap, repoName) {
  const repository = repoMap.repositories[repoName];
  if (!repository) {
    throw new Error(`Unknown repository "${repoName}".`);
  }

  return repository;
}

export function getPhaseNamesForRepo(repoMap, repoName) {
  return repoMap.phases
    .filter((phase) => phase.repositories.includes(repoName))
    .map((phase) => phase.name);
}

async function getPathType(absolutePath) {
  try {
    const result = await stat(absolutePath);
    return result.isDirectory() ? 'directory' : 'file';
  } catch {
    return null;
  }
}

export async function resolveRepositoryPaths(repoMap, repoName) {
  const repository = getRepository(repoMap, repoName);

  return Promise.all(
    repository.paths.map(async (mappedPath) => {
      const absolutePath = resolve(ROOT, mappedPath);
      const type = await getPathType(absolutePath);

      return {
        absolutePath,
        exists: Boolean(type),
        path: normalizePath(mappedPath),
        type
      };
    })
  );
}
