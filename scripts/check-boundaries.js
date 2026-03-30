import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const SKIP_DIRECTORIES = new Set(['.git', '.expo-cache', '.expo-home', 'coverage', 'dist', 'node_modules']);
const WORKSPACE_SCOPES = ['apps', 'packages', 'contracts'];
const IMPORT_PATTERNS = [
  /(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function getWorkspaceRoot(filePath) {
  const normalized = normalizePath(relative(ROOT, filePath));
  const segments = normalized.split('/');

  if (WORKSPACE_SCOPES.includes(segments[0]) && segments[1]) {
    return resolve(ROOT, segments[0], segments[1]);
  }

  return null;
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true
  });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(directory, entry.parentPath ? relative(directory, entry.parentPath) : '', entry.name))
    .filter((filePath) => {
      const segments = normalizePath(relative(ROOT, filePath)).split('/');
      return !segments.some((segment) => SKIP_DIRECTORIES.has(segment)) && SOURCE_EXTENSIONS.has(extname(filePath));
    });
}

async function collectWorkspacePackageFiles() {
  const packageFiles = [];

  for (const scope of WORKSPACE_SCOPES) {
    const scopePath = resolve(ROOT, scope);
    let entries = [];

    try {
      entries = await readdir(scopePath, {
        withFileTypes: true
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }

      packageFiles.push(resolve(scopePath, entry.name, 'package.json'));
    }
  }

  return packageFiles;
}

function collectSpecifiers(source) {
  const specifiers = [];

  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function validateSpecifier(filePath, specifier) {
  const workspaceRoot = getWorkspaceRoot(filePath);
  if (!workspaceRoot) {
    return [];
  }

  const violations = [];

  if (specifier.startsWith('@afrochain/')) {
    const parts = specifier.split('/');
    if (parts.length > 2) {
      violations.push(
        `${normalizePath(relative(ROOT, filePath))}: deep package import "${specifier}" breaks clean package boundaries.`
      );
    }

    return violations;
  }

  if (!specifier.startsWith('.')) {
    return violations;
  }

  const targetPath = resolve(dirname(filePath), specifier);
  const normalizedWorkspaceRoot = normalizePath(workspaceRoot);
  const normalizedTargetPath = normalizePath(targetPath);

  if (!normalizedTargetPath.startsWith(normalizedWorkspaceRoot)) {
    const targetWorkspace = getWorkspaceRoot(targetPath);

    if (targetWorkspace) {
      violations.push(
        `${normalizePath(relative(ROOT, filePath))}: relative cross-workspace import "${specifier}" reaches into ${normalizePath(
          relative(ROOT, targetWorkspace)
        )}. Use the target package entrypoint instead.`
      );
    } else {
      violations.push(
        `${normalizePath(relative(ROOT, filePath))}: relative import "${specifier}" escapes its workspace root.`
      );
    }
  }

  return violations;
}

async function main() {
  const sourceRoots = [resolve(ROOT, 'apps'), resolve(ROOT, 'packages')];
  const files = (await Promise.all(sourceRoots.map((directory) => collectSourceFiles(directory)))).flat();
  const violations = [];

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    for (const specifier of collectSpecifiers(source)) {
      violations.push(...validateSpecifier(filePath, specifier));
    }
  }

  const packageFiles = await collectWorkspacePackageFiles();
  for (const packageFile of packageFiles) {
    try {
      const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
      const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

      for (const group of dependencyGroups) {
        for (const [name, version] of Object.entries(manifest[group] || {})) {
          if (name.startsWith('@afrochain/') && typeof version === 'string' && version.startsWith('file:')) {
            violations.push(
              `${normalizePath(relative(ROOT, packageFile))}: dependency "${name}" uses "${version}". Use a clean local package version such as the matching workspace version instead of a path-based dependency.`
            );
          }

          if (name.startsWith('@afrochain/') && typeof version === 'string' && version.includes('/src')) {
            violations.push(
              `${normalizePath(relative(ROOT, packageFile))}: dependency "${name}" points at source internals. Depend on the package entrypoint instead.`
            );
          }
        }
      }
    } catch {
      continue;
    }
  }

  if (violations.length) {
    console.error('AfroChain boundary check failed.\n');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`AfroChain boundary check passed for ${files.length} source files and ${packageFiles.length} workspace manifests.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
