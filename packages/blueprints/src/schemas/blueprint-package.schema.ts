import { z } from 'zod'

/**
 * Schema for kompo.blueprint.json — the manifest file that every blueprint package
 * (official or community) must include at its root.
 *
 * This manifest declares what the package provides (frameworks, adapters, starters, etc.)
 * and where to find the blueprint elements within the package.
 */

export const blueprintPackagePathsSchema = z.object({
  elements: z.string().optional().default('elements/'),
  libs: z.string().optional(),
  features: z.string().optional(),
  starters: z.string().optional(),
})

const baseBlueprintPackageSchema = z.object({
  $schema: z.string().optional(),
  kompo: z.string().min(1, 'Kompo version is required'),
  name: z.string().min(1, 'Package name is required'),
  paths: blueprintPackagePathsSchema.optional(),
})

export const coreBlueprintPackageSchema = baseBlueprintPackageSchema.extend({
  type: z.literal('core'),
  adapters: z.array(z.string()).optional(),
  drivers: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
})

export const frameworkBlueprintPackageSchema = baseBlueprintPackageSchema.extend({
  type: z.literal('framework'),
  frameworks: z.array(z.string()).min(1, 'At least one framework is required'),
  family: z.string().min(1, 'Family is required'),
  designSystems: z.array(z.string()).optional(),
  starters: z.array(z.string()).optional(),
})

export const blueprintPackageSchema = z.discriminatedUnion('type', [
  coreBlueprintPackageSchema,
  frameworkBlueprintPackageSchema,
])

export type BlueprintPackageManifest = z.infer<typeof blueprintPackageSchema>
export type CoreBlueprintPackage = z.infer<typeof coreBlueprintPackageSchema>
export type FrameworkBlueprintPackage = z.infer<typeof frameworkBlueprintPackageSchema>
export type BlueprintPackagePaths = z.infer<typeof blueprintPackagePathsSchema>
