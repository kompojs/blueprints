/**
 * Blueprint Resolver — resolves blueprint elements from multiple sources.
 *
 * Resolution order:
 *   1. LOCAL — project-level overrides (.kompo/blueprints/)
 *   2. INSTALLED — npm packages with kompo.blueprint.json in node_modules
 *   3. CORE — fallback to @kompojs/blueprints (adapters, drivers, shared, features)
 *
 * Discovery: lists all available blueprints across all sources.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Blueprint, FeatureManifest, StarterManifest } from './types'
import type { BlueprintPackageManifest, FrameworkBlueprintPackage } from './schemas/blueprint-package.schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlueprintSourceKind = 'local' | 'installed' | 'core'

export interface ResolvedBlueprint {
  blueprint: Blueprint
  source: BlueprintSourceKind
  packageName?: string
  basePath: string
}

export interface ResolvedStarter {
  starter: StarterManifest
  source: BlueprintSourceKind
  packageName?: string
  basePath: string
}

export interface ResolvedFeature {
  feature: FeatureManifest
  source: BlueprintSourceKind
  packageName?: string
  basePath: string
}

export interface DiscoveredPackage {
  manifest: BlueprintPackageManifest
  packageRoot: string
  source: BlueprintSourceKind
}

export class BlueprintNotFoundError extends Error {
  constructor(
    public readonly blueprintType: string,
    public readonly blueprintName: string,
    public readonly suggestions: string[] = [],
  ) {
    const msg = suggestions.length
      ? `Blueprint "${blueprintName}" (${blueprintType}) not found. Did you mean: ${suggestions.join(', ')}?`
      : `Blueprint "${blueprintName}" (${blueprintType}) not found.`
    super(msg)
    this.name = 'BlueprintNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Root of the @kompojs/blueprints package (one level up from src/) */
const CORE_PACKAGE_ROOT = resolve(__dirname, '..')

function readJsonSafe<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function readBlueprintManifest(dir: string): BlueprintPackageManifest | null {
  return readJsonSafe<BlueprintPackageManifest>(join(dir, 'kompo.blueprint.json'))
}

function getElementsDir(packageRoot: string, manifest: BlueprintPackageManifest): string {
  const elementsPath = manifest.paths?.elements ?? 'elements/'
  return resolve(packageRoot, elementsPath)
}

function getStartersDir(packageRoot: string, manifest: BlueprintPackageManifest): string {
  const startersPath = manifest.paths?.starters ?? 'starters/'
  return resolve(packageRoot, startersPath)
}

function getFeaturesDir(packageRoot: string, manifest: BlueprintPackageManifest): string {
  const featuresPath = manifest.paths?.features ?? 'features/'
  return resolve(packageRoot, featuresPath)
}

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

function scanBlueprints(dir: string, maxDepth = 4): Blueprint[] {
  if (!existsSync(dir)) return []
  const blueprints: Blueprint[] = []

  function scan(currentDir: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = join(currentDir, entry.name as string)
        const bpPath = join(fullPath, 'blueprint.json')
        if (existsSync(bpPath)) {
          const bp = readJsonSafe<Blueprint>(bpPath)
          if (bp) { bp.path = fullPath; blueprints.push(bp) }
        }
        scan(fullPath, depth + 1)
      }
    } catch { return }
  }
  scan(dir, 1)
  return blueprints
}

function scanStarters(dir: string, maxDepth = 4): StarterManifest[] {
  if (!existsSync(dir)) return []
  const starters: StarterManifest[] = []

  function scan(currentDir: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = join(currentDir, entry.name as string)
        const starterPath = join(fullPath, 'starter.json')
        if (existsSync(starterPath)) {
          const starter = readJsonSafe<StarterManifest>(starterPath)
          if (starter) { starter.path = fullPath; starters.push(starter) }
        }
        scan(fullPath, depth + 1)
      }
    } catch { return }
  }
  scan(dir, 1)
  return starters.filter((s) => s.steps && s.steps.length > 0)
}

function scanFeatures(dir: string, maxDepth = 1): FeatureManifest[] {
  if (!existsSync(dir)) return []
  const features: FeatureManifest[] = []

  function scan(currentDir: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = join(currentDir, entry.name as string)
        const featurePath = join(fullPath, 'features.json')
        if (existsSync(featurePath)) {
          const feature = readJsonSafe<FeatureManifest>(featurePath)
          if (feature) {
            feature.path = fullPath
            if (feature.type !== 'feature') feature.type = 'feature'
            features.push(feature)
          }
        }
        scan(fullPath, depth + 1)
      }
    } catch { return }
  }
  scan(dir, 1)
  return features
}

// ---------------------------------------------------------------------------
// Discovery: find installed blueprint packages in node_modules
// ---------------------------------------------------------------------------

function scanNodeModulesForBlueprints(nodeModulesDir: string, packages: DiscoveredPackage[], seen: Set<string>): void {
  if (!existsSync(nodeModulesDir)) return

  // Scan @kompojs/blueprints-* (official)
  const kompoScopeDir = join(nodeModulesDir, '@kompojs')
  if (existsSync(kompoScopeDir)) {
    try {
      for (const entry of readdirSync(kompoScopeDir, { withFileTypes: true })) {
        // Fix: Use lstatSync to properly detect symlinks as directories
        const entryPath = join(kompoScopeDir, entry.name)
        const isDir = entry.isDirectory() || (lstatSync(entryPath).isSymbolicLink() && existsSync(entryPath))
        if (!isDir || !entry.name.startsWith('blueprints-')) continue
        const pkgRoot = realpathSync(entryPath)
        if (seen.has(pkgRoot)) continue
        seen.add(pkgRoot)
        const manifest = readBlueprintManifest(pkgRoot)
        if (manifest) {
          packages.push({ manifest, packageRoot: pkgRoot, source: 'installed' })
        }
      }
    } catch {}
  }

  // Scan community packages: @*/kompo-blueprints-*
  try {
    for (const scopeEntry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
      if (!scopeEntry.isDirectory() || !scopeEntry.name.startsWith('@')) continue
      if (scopeEntry.name === '@kompojs') continue
      const scopeDir = join(nodeModulesDir, scopeEntry.name)
      try {
        for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.startsWith('kompo-blueprints-')) continue
          const pkgRoot = realpathSync(join(scopeDir, entry.name))
          if (seen.has(pkgRoot)) continue
          seen.add(pkgRoot)
          const manifest = readBlueprintManifest(pkgRoot)
          if (manifest) {
            packages.push({ manifest, packageRoot: pkgRoot, source: 'installed' })
          }
        }
      } catch {}
    }
  } catch {}
}

function findInstalledBlueprintPackages(projectRoot: string): DiscoveredPackage[] {
  const packages: DiscoveredPackage[] = []
  const seen = new Set<string>()

  // 1. Scan the user project's node_modules
  scanNodeModulesForBlueprints(join(projectRoot, 'node_modules'), packages, seen)

  // 2. Also scan the node_modules tree that contains @kompojs/blueprints itself.
  //    This ensures framework blueprint packages are discovered during local
  //    development when the user project doesn't have them installed.
  const coreNodeModules = resolve(CORE_PACKAGE_ROOT, 'node_modules')
  if (coreNodeModules !== join(projectRoot, 'node_modules')) {
    scanNodeModulesForBlueprints(coreNodeModules, packages, seen)
  }

  // 3. Walk up from CORE_PACKAGE_ROOT to find ancestor node_modules (pnpm hoisting)
  let current = resolve(CORE_PACKAGE_ROOT, '..')
  for (let i = 0; i < 5; i++) {
    const ancestorNm = join(current, 'node_modules')
    if (ancestorNm !== join(projectRoot, 'node_modules') && ancestorNm !== coreNodeModules) {
      scanNodeModulesForBlueprints(ancestorNm, packages, seen)
    }
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }

  return packages
}

// ---------------------------------------------------------------------------
// Blueprint candidate path builder
// ---------------------------------------------------------------------------

function buildBlueprintCandidates(elementsDir: string, type: string, name: string): string[] {
  switch (type) {
    case 'adapter':
      return [join(elementsDir, 'libs', 'adapters', name)]
    case 'driver':
      return [join(elementsDir, 'libs', 'drivers', name)]
    case 'app':
      return [join(elementsDir, 'apps', name)]
    case 'design-system': {
      // name format: "react/shadcn" or just "shadcn"
      const parts = name.split('/')
      if (parts.length === 2) {
        return [join(elementsDir, 'libs', 'ui', parts[0], parts[1])]
      }
      return [join(elementsDir, 'libs', 'ui', name)]
    }
    case 'lib':
      return [join(elementsDir, 'libs', name)]
    default:
      return [
        join(elementsDir, 'libs', 'adapters', name),
        join(elementsDir, 'libs', 'drivers', name),
        join(elementsDir, 'libs', name),
      ]
  }
}

// ---------------------------------------------------------------------------
// Blueprint Registry interface
// ---------------------------------------------------------------------------

export interface BlueprintRegistry {
  packages: DiscoveredPackage[]
  resolveBlueprint(type: string, name: string): ResolvedBlueprint | null
  resolveStarter(name: string): ResolvedStarter | null
  resolveFeature(name: string): ResolvedFeature | null
  resolveFrameworkDir(framework: string): string | null
  resolveDesignSystemDir(framework: string, designSystem: string): string | null
  listFrameworks(): string[]
  listStarters(): ResolvedStarter[]
  listFeatures(): ResolvedFeature[]
  listBlueprints(): ResolvedBlueprint[]
  listDesignSystems(family?: string): string[]
  getTemplatesDirForFramework(framework: string): string | null
  getCoreTemplatesDir(): string
  getBlueprintCatalogPath(blueprintPath: string): string | null
  hasBlueprintSnippet(blueprintPath: string, snippetName: string): boolean
  getFrameworkCompositionTemplates(framework: string): string[]
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

export function createBlueprintRegistry(projectRoot: string): BlueprintRegistry {
  const coreManifest = readBlueprintManifest(CORE_PACKAGE_ROOT)
  const corePackage: DiscoveredPackage | null = coreManifest
    ? { manifest: coreManifest, packageRoot: CORE_PACKAGE_ROOT, source: 'core' }
    : null

  const installedPackages = findInstalledBlueprintPackages(projectRoot)

  const localBlueprintsDir = join(projectRoot, '.kompo', 'blueprints')
  const localManifest = readBlueprintManifest(localBlueprintsDir)
  const localPackage: DiscoveredPackage | null = localManifest
    ? { manifest: localManifest, packageRoot: localBlueprintsDir, source: 'local' }
    : null

  const allPackages: DiscoveredPackage[] = [
    ...(localPackage ? [localPackage] : []),
    ...installedPackages,
    ...(corePackage ? [corePackage] : []),
  ]

  // Build framework → package mapping (first-match wins, local > installed > core)
  const frameworkMap = new Map<string, DiscoveredPackage>()
  for (const pkg of allPackages) {
    if (pkg.manifest.type === 'framework') {
      for (const fw of (pkg.manifest as FrameworkBlueprintPackage).frameworks) {
        if (!frameworkMap.has(fw)) {
          frameworkMap.set(fw, pkg)
        }
      }
    }
  }

  // --- Core templates dir ---

  function getCoreTemplatesDir(): string {
    if (corePackage) return getElementsDir(corePackage.packageRoot, corePackage.manifest)
    return resolve(CORE_PACKAGE_ROOT, 'elements')
  }

  function getTemplatesDirForFramework(framework: string): string | null {
    const pkg = frameworkMap.get(framework)
    if (!pkg) return null
    return getElementsDir(pkg.packageRoot, pkg.manifest)
  }

  // --- resolveBlueprint ---

  function resolveBlueprint(type: string, name: string): ResolvedBlueprint | null {
    // 1. LOCAL
    if (localPackage) {
      const localElements = getElementsDir(localPackage.packageRoot, localPackage.manifest)
      for (const dir of buildBlueprintCandidates(localElements, type, name)) {
        const bp = readJsonSafe<Blueprint>(join(dir, 'blueprint.json'))
        if (bp) { bp.path = dir; return { blueprint: bp, source: 'local', basePath: dir } }
      }
    }

    // 2. INSTALLED — for app/design-system types, check framework packages
    if (type === 'app' || type === 'design-system') {
      for (const pkg of installedPackages) {
        const elemDir = getElementsDir(pkg.packageRoot, pkg.manifest)
        for (const dir of buildBlueprintCandidates(elemDir, type, name)) {
          const bp = readJsonSafe<Blueprint>(join(dir, 'blueprint.json'))
          if (bp) { bp.path = dir; return { blueprint: bp, source: 'installed', packageName: pkg.manifest.name, basePath: dir } }
        }
      }
    }

    // 3. CORE
    const coreElements = getCoreTemplatesDir()
    for (const dir of buildBlueprintCandidates(coreElements, type, name)) {
      const bp = readJsonSafe<Blueprint>(join(dir, 'blueprint.json'))
      if (bp) { bp.path = dir; return { blueprint: bp, source: 'core', packageName: '@kompojs/blueprints', basePath: dir } }
    }

    return null
  }

  // --- resolveStarter ---

  function resolveStarter(name: string): ResolvedStarter | null {
    const relativePath = name.split('.').join('/')

    // 1. LOCAL
    if (localPackage) {
      const startersDir = getStartersDir(localPackage.packageRoot, localPackage.manifest)
      const starterDir = join(startersDir, relativePath)
      const starter = readJsonSafe<StarterManifest>(join(starterDir, 'starter.json'))
      if (starter) { starter.path = starterDir; return { starter, source: 'local', basePath: starterDir } }
    }

    // 2. INSTALLED
    for (const pkg of installedPackages) {
      const startersDir = getStartersDir(pkg.packageRoot, pkg.manifest)
      const starterDir = join(startersDir, relativePath)
      const starter = readJsonSafe<StarterManifest>(join(starterDir, 'starter.json'))
      if (starter) { starter.path = starterDir; return { starter, source: 'installed', packageName: pkg.manifest.name, basePath: starterDir } }
    }

    // 3. CORE fallback (during migration)
    if (corePackage) {
      const startersDir = getStartersDir(corePackage.packageRoot, corePackage.manifest)
      const starterDir = join(startersDir, relativePath)
      const starter = readJsonSafe<StarterManifest>(join(starterDir, 'starter.json'))
      if (starter) { starter.path = starterDir; return { starter, source: 'core', packageName: '@kompojs/blueprints', basePath: starterDir } }
    }

    // 4. Absolute path fallback
    if (existsSync(join(name, 'starter.json'))) {
      const starter = readJsonSafe<StarterManifest>(join(name, 'starter.json'))
      if (starter) { starter.path = name; return { starter, source: 'local', basePath: name } }
    }

    return null
  }

  // --- resolveFeature ---

  function resolveFeature(name: string): ResolvedFeature | null {
    // 1. LOCAL
    if (localPackage) {
      const featuresDir = getFeaturesDir(localPackage.packageRoot, localPackage.manifest)
      const featurePath = join(featuresDir, name, 'features.json')
      const feature = readJsonSafe<FeatureManifest>(featurePath)
      if (feature) {
        feature.path = dirname(featurePath)
        feature.type = 'feature'
        return { feature, source: 'local', basePath: dirname(featurePath) }
      }
    }

    // 2. CORE
    if (corePackage) {
      const featuresDir = getFeaturesDir(corePackage.packageRoot, corePackage.manifest)
      const featurePath = join(featuresDir, name, 'features.json')
      const feature = readJsonSafe<FeatureManifest>(featurePath)
      if (feature) {
        feature.path = dirname(featurePath)
        feature.type = 'feature'
        return { feature, source: 'core', packageName: '@kompojs/blueprints', basePath: dirname(featurePath) }
      }
    }

    return null
  }

  // --- resolveFrameworkDir ---

  function resolveFrameworkDir(framework: string): string | null {
    if (localPackage) {
      const dir = join(getElementsDir(localPackage.packageRoot, localPackage.manifest), 'apps', framework)
      if (existsSync(dir)) return dir
    }

    const pkg = frameworkMap.get(framework)
    if (pkg && pkg.source !== 'core') {
      const dir = join(getElementsDir(pkg.packageRoot, pkg.manifest), 'apps', framework)
      if (existsSync(dir)) return dir
    }

    // CORE fallback (during migration, apps may still be in core)
    const dir = join(getCoreTemplatesDir(), 'apps', framework)
    if (existsSync(dir)) return dir

    return null
  }

  // --- resolveDesignSystemDir ---

  function resolveDesignSystemDir(framework: string, designSystem: string): string | null {
    const pkg = frameworkMap.get(framework)
    const family = pkg?.manifest.type === 'framework'
      ? (pkg.manifest as FrameworkBlueprintPackage).family
      : null

    const sources: string[] = []
    if (localPackage) sources.push(getElementsDir(localPackage.packageRoot, localPackage.manifest))
    if (pkg && pkg.source !== 'core') sources.push(getElementsDir(pkg.packageRoot, pkg.manifest))
    sources.push(getCoreTemplatesDir())

    for (const elemDir of sources) {
      if (family) {
        const dir = join(elemDir, 'libs', 'ui', family, designSystem)
        if (existsSync(dir)) return dir
      }
      const dir = join(elemDir, 'libs', 'ui', designSystem)
      if (existsSync(dir)) return dir
    }

    return null
  }

  // --- List methods ---

  function listFrameworks(): string[] {
    return Array.from(frameworkMap.keys())
  }

  function listStarters(): ResolvedStarter[] {
    const results: ResolvedStarter[] = []
    if (localPackage) {
      for (const s of scanStarters(getStartersDir(localPackage.packageRoot, localPackage.manifest))) {
        results.push({ starter: s, source: 'local', basePath: s.path! })
      }
    }
    for (const pkg of installedPackages) {
      for (const s of scanStarters(getStartersDir(pkg.packageRoot, pkg.manifest))) {
        results.push({ starter: s, source: 'installed', packageName: pkg.manifest.name, basePath: s.path! })
      }
    }
    if (corePackage) {
      for (const s of scanStarters(getStartersDir(corePackage.packageRoot, corePackage.manifest))) {
        results.push({ starter: s, source: 'core', packageName: '@kompojs/blueprints', basePath: s.path! })
      }
    }
    return results
  }

  function listFeatures(): ResolvedFeature[] {
    const results: ResolvedFeature[] = []
    if (localPackage) {
      for (const f of scanFeatures(getFeaturesDir(localPackage.packageRoot, localPackage.manifest))) {
        results.push({ feature: f, source: 'local', basePath: f.path! })
      }
    }
    if (corePackage) {
      for (const f of scanFeatures(getFeaturesDir(corePackage.packageRoot, corePackage.manifest))) {
        results.push({ feature: f, source: 'core', packageName: '@kompojs/blueprints', basePath: f.path! })
      }
    }
    return results
  }

  function listBlueprints(): ResolvedBlueprint[] {
    const results: ResolvedBlueprint[] = []
    if (localPackage) {
      const libsDir = join(getElementsDir(localPackage.packageRoot, localPackage.manifest), 'libs')
      for (const bp of scanBlueprints(libsDir)) {
        results.push({ blueprint: bp, source: 'local', basePath: bp.path! })
      }
    }
    for (const pkg of installedPackages) {
      const libsDir = join(getElementsDir(pkg.packageRoot, pkg.manifest), 'libs')
      for (const bp of scanBlueprints(libsDir)) {
        results.push({ blueprint: bp, source: 'installed', packageName: pkg.manifest.name, basePath: bp.path! })
      }
    }
    const coreLibsDir = join(getCoreTemplatesDir(), 'libs')
    for (const bp of scanBlueprints(coreLibsDir)) {
      results.push({ blueprint: bp, source: 'core', packageName: '@kompojs/blueprints', basePath: bp.path! })
    }
    return results
  }

  function listDesignSystems(family?: string): string[] {
    const results = new Set<string>()
    const sources: string[] = []
    if (localPackage) sources.push(getElementsDir(localPackage.packageRoot, localPackage.manifest))
    for (const pkg of installedPackages) sources.push(getElementsDir(pkg.packageRoot, pkg.manifest))
    sources.push(getCoreTemplatesDir())

    for (const elemDir of sources) {
      const baseUiDir = join(elemDir, 'libs', 'ui')
      const uiDir = family ? join(baseUiDir, family) : baseUiDir
      if (!existsSync(uiDir)) continue
      try {
        for (const entry of readdirSync(uiDir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) results.add(entry.name)
        }
      } catch {}
    }
    return Array.from(results)
  }

  // --- Utility methods ---

  function getBlueprintCatalogPath(blueprintPath: string): string | null {
    const sources: string[] = []
    if (localPackage) sources.push(getElementsDir(localPackage.packageRoot, localPackage.manifest))
    for (const pkg of installedPackages) sources.push(getElementsDir(pkg.packageRoot, pkg.manifest))
    sources.push(getCoreTemplatesDir())

    for (const elemDir of sources) {
      const candidatePath = join(elemDir, blueprintPath, 'catalog.json')
      if (existsSync(candidatePath)) return candidatePath
    }
    return null
  }

  function hasBlueprintSnippet(blueprintPath: string, snippetName: string): boolean {
    const sources: string[] = []
    if (localPackage) sources.push(getElementsDir(localPackage.packageRoot, localPackage.manifest))
    for (const pkg of installedPackages) sources.push(getElementsDir(pkg.packageRoot, pkg.manifest))
    sources.push(getCoreTemplatesDir())

    for (const elemDir of sources) {
      if (existsSync(join(elemDir, blueprintPath, 'snippets', `${snippetName}.eta`))) return true
    }
    return false
  }

  function getFrameworkCompositionTemplates(framework: string): string[] {
    const frameworkDir = resolveFrameworkDir(framework)
    if (!frameworkDir) return []
    const base = join(frameworkDir, 'framework')

    if (framework === 'vue' || framework === 'nuxt') {
      return [
        join(base, 'src', 'composition', 'ClientComposition.vue.eta'),
        join(base, 'src', 'composition', 'ServerComposition.ts.eta'),
      ].filter((p) => existsSync(p))
    }
    return [
      join(base, 'src', 'composition', 'ClientComposition.tsx.eta'),
      join(base, 'src', 'composition', 'ServerComposition.tsx.eta'),
    ].filter((p) => existsSync(p))
  }

  return {
    packages: allPackages,
    resolveBlueprint,
    resolveStarter,
    resolveFeature,
    resolveFrameworkDir,
    resolveDesignSystemDir,
    listFrameworks,
    listStarters,
    listFeatures,
    listBlueprints,
    listDesignSystems,
    getTemplatesDirForFramework,
    getCoreTemplatesDir,
    getBlueprintCatalogPath,
    hasBlueprintSnippet,
    getFrameworkCompositionTemplates,
  }
}
