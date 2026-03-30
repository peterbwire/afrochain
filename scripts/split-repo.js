import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import {
  ROOT,
  getPhaseNamesForRepo,
  getRepository,
  loadRepoMap,
  normalizePath,
  resolveRepositoryPaths
} from './lib/repo-map.js';

function parseArgs(argv) {
  const [command = 'help', ...tokens] = argv;
  const flags = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const nextValue = tokens[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = nextValue;
    index += 1;
  }

  return {
    command,
    flags
  };
}

function printHelp() {
  console.log(`AfroChain Split Tool

Commands:
  list
  show --repo afrochain-sdk
  export --repo afrochain-sdk --out .split-preview/afrochain-sdk [--force] [--dry-run]
`);
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    throw new Error(`Missing required flag --${name}`);
  }

  return flags[name];
}

async function ensureOutputDirectory(outputPath, force) {
  if (force) {
    await rm(outputPath, {
      force: true,
      recursive: true
    });
  }

  await mkdir(outputPath, {
    recursive: true
  });
}

async function buildExportManifest(repoMap, repoName, resolvedPaths) {
  const repository = getRepository(repoMap, repoName);
  const packageManifests = [];

  for (const pathInfo of resolvedPaths) {
    if (pathInfo.type !== 'directory') {
      continue;
    }

    try {
      const manifest = JSON.parse(await readFile(resolve(pathInfo.absolutePath, 'package.json'), 'utf8'));
      packageManifests.push({
        name: manifest.name || null,
        path: pathInfo.path,
        version: manifest.version || null
      });
    } catch {
      continue;
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    extractedFrom: repoMap.currentPrimaryRepo,
    organization: repoMap.organization,
    packageManifests,
    paths: resolvedPaths.map((pathInfo) => ({
      path: pathInfo.path,
      type: pathInfo.type
    })),
    phases: getPhaseNamesForRepo(repoMap, repoName),
    repository: repoName,
    status: repository.status,
    strategy: repoMap.strategy
  };
}

async function exportRepository(repoMap, repoName, flags) {
  const outputPath = resolve(ROOT, requireFlag(flags, 'out'));
  const resolvedPaths = await resolveRepositoryPaths(repoMap, repoName);
  const missingPaths = resolvedPaths.filter((pathInfo) => !pathInfo.exists);

  if (missingPaths.length) {
    throw new Error(
      `Cannot export ${repoName}; missing mapped paths: ${missingPaths.map((pathInfo) => pathInfo.path).join(', ')}`
    );
  }

  if (flags['dry-run']) {
    printJson({
      dryRun: true,
      outputPath: normalizePath(relative(ROOT, outputPath)),
      repository: repoName,
      paths: resolvedPaths.map((pathInfo) => pathInfo.path)
    });
    return;
  }

  await ensureOutputDirectory(outputPath, Boolean(flags.force));

  for (const pathInfo of resolvedPaths) {
    const targetPath = resolve(outputPath, pathInfo.path);
    await mkdir(dirname(targetPath), {
      recursive: true
    });
    await cp(pathInfo.absolutePath, targetPath, {
      recursive: true
    });
  }

  const manifest = await buildExportManifest(repoMap, repoName, resolvedPaths);
  await writeFile(resolve(outputPath, 'split-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(
    resolve(outputPath, 'README.generated.md'),
    `# ${repoName}

This preview export was generated from the AfroChain monorepo.

- Source repository: ${repoMap.currentPrimaryRepo}
- Strategy: ${repoMap.strategy}
- Exported at: ${manifest.exportedAt}
- Included paths:
${resolvedPaths.map((pathInfo) => `  - ${pathInfo.path}`).join('\n')}

This preview preserves original monorepo-relative paths to keep extraction deterministic.
`,
    'utf8'
  );

  printJson({
    exported: true,
    outputPath: normalizePath(relative(ROOT, outputPath)),
    repository: repoName
  });
}

async function listRepositories(repoMap) {
  const payload = Object.entries(repoMap.repositories).map(([repoName, repository]) => ({
    name: repoName,
    pathCount: repository.paths.length,
    phases: getPhaseNamesForRepo(repoMap, repoName),
    status: repository.status
  }));
  printJson(payload);
}

async function showRepository(repoMap, repoName) {
  const repository = getRepository(repoMap, repoName);
  const resolvedPaths = await resolveRepositoryPaths(repoMap, repoName);

  printJson({
    futureSplitTargets: repository.futureSplitTargets || [],
    name: repoName,
    paths: resolvedPaths.map((pathInfo) => ({
      exists: pathInfo.exists,
      path: pathInfo.path,
      type: pathInfo.type
    })),
    phases: getPhaseNamesForRepo(repoMap, repoName),
    status: repository.status
  });
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help') {
    printHelp();
    return;
  }

  const repoMap = await loadRepoMap();

  switch (command) {
    case 'list':
      await listRepositories(repoMap);
      return;
    case 'show':
      await showRepository(repoMap, requireFlag(flags, 'repo'));
      return;
    case 'export':
      await exportRepository(repoMap, requireFlag(flags, 'repo'), flags);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
