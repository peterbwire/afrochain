import { access } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { ROOT, getPhaseNamesForRepo, loadRepoMap, normalizePath, resolveRepositoryPaths } from './lib/repo-map.js';

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateRepository(repoMap, repoName) {
  const repository = repoMap.repositories[repoName];
  const resolvedPaths = await resolveRepositoryPaths(repoMap, repoName);
  const issues = [];
  const notes = [];

  if (!repository.paths.length) {
    issues.push(`Repository "${repoName}" does not define any mapped paths.`);
  }

  for (const pathInfo of resolvedPaths) {
    if (!pathInfo.exists) {
      issues.push(`Mapped path "${pathInfo.path}" does not exist.`);
      continue;
    }

    if (pathInfo.type === 'directory') {
      const readmePath = resolve(pathInfo.absolutePath, 'README.md');
      const packagePath = resolve(pathInfo.absolutePath, 'package.json');
      const hasReadme = await pathExists(readmePath);
      const hasPackage = await pathExists(packagePath);

      if (!hasReadme && !hasPackage) {
        issues.push(`Directory "${pathInfo.path}" should include README.md or package.json for clean extraction.`);
      } else {
        notes.push(
          `${pathInfo.path}: ${[hasPackage ? 'package.json' : null, hasReadme ? 'README.md' : null].filter(Boolean).join(
            ' + '
          )}`
        );
      }
    } else {
      notes.push(`${pathInfo.path}: file`);
    }
  }

  return {
    issues,
    notes,
    phases: getPhaseNamesForRepo(repoMap, repoName),
    repoName,
    status: repository.status
  };
}

async function main() {
  const repoMap = await loadRepoMap();
  const validations = await Promise.all(
    Object.keys(repoMap.repositories).map((repoName) => validateRepository(repoMap, repoName))
  );
  const issues = validations.flatMap((validation) =>
    validation.issues.map((issue) => `${validation.repoName}: ${issue}`)
  );

  if (issues.length) {
    console.error('AfroChain split-readiness check failed.\n');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`AfroChain split-readiness check passed for ${validations.length} repositories.\n`);
  for (const validation of validations) {
    const phaseLabel = validation.phases.length ? validation.phases.join(', ') : 'unassigned';
    console.log(
      `- ${validation.repoName} [${validation.status}] (${phaseLabel}) :: ${validation.notes.length} extraction markers`
    );
  }

  console.log(`\nSource map: ${normalizePath(relative(ROOT, resolve(ROOT, 'repo-map.json')))}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
