<div align="center">
  <h1>@kompojs/blueprints</h1>
  <p><strong>Blueprint packages for the Kompo framework.</strong></p>
  <p>Starters, adapters, design systems, and framework templates.</p>

  <p>
    <a href="https://www.npmjs.com/package/@kompojs/blueprints"><img src="https://img.shields.io/npm/v/@kompojs/blueprints?style=flat-square&color=blue" alt="Version" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" /></a>
  </p>
</div>

---

## What is this repo?

This monorepo contains all the **blueprint packages** for [Kompo](https://kompo.dev). Blueprints define the templates, starters, adapters, and design system integrations that the Kompo CLI uses to scaffold and generate code.

## Packages

| Package | Description |
|:--|:--|
| `@kompojs/blueprints` | Core blueprints (adapters, drivers, features, starters for all frameworks) |
| `@kompojs/blueprints-nextjs` | Next.js-specific elements and starters |
| `@kompojs/blueprints-react` | React-specific elements and starters |
| `@kompojs/blueprints-nuxt` | Nuxt-specific elements and starters |
| `@kompojs/blueprints-vue` | Vue-specific elements and starters |
| `@kompojs/blueprints-express` | Express-specific elements and starters |

## How Blueprints Work

When you run `kompo add app`, the CLI resolves blueprints using a **registry** with this resolution order:

1. **Local** (`.kompo/templates/`) — your project overrides
2. **Installed packages** (`@kompojs/blueprints-nextjs`, etc.) — framework-specific
3. **Core** (`@kompojs/blueprints`) — built-in fallback

### Blueprint Package Manifest

Each blueprint package declares its capabilities via a `kompo.blueprint.json`:

```json
{
  "$schema": "https://kompojs.dev/schemas/kompo.blueprint.json",
  "kompo": "1.0",
  "name": "@kompojs/blueprints-nextjs",
  "type": "framework",
  "framework": "nextjs",
  "paths": {
    "elements": "elements/",
    "starters": "starters/"
  }
}
```

## Creating a Custom Blueprint Package

You can create your own blueprint package for community or internal use:

### 1. Create the package

```bash
mkdir my-kompo-blueprints && cd my-kompo-blueprints
npm init -y
```

### 2. Add the manifest

Create `kompo.blueprint.json`:

```json
{
  "$schema": "https://kompojs.dev/schemas/kompo.blueprint.json",
  "kompo": "1.0",
  "name": "@acme/kompo-blueprints-sveltekit",
  "type": "framework",
  "framework": "sveltekit",
  "paths": {
    "elements": "elements/",
    "starters": "starters/"
  }
}
```

### 3. Add elements and starters

```
my-kompo-blueprints/
  kompo.blueprint.json
  elements/
    apps/sveltekit/
      framework/
        files/          # Template files (.eta)
        catalog.json    # Dependencies
  starters/
    sveltekit/
      tailwind/
        blank/
          starter.json
```

### 4. Publish

```bash
npm publish
```

Users install it with:

```bash
pnpm add -D @acme/kompo-blueprints-sveltekit
```

The Kompo CLI will automatically discover it.

## Development

```bash
git clone https://github.com/kompojs/blueprints.git
cd blueprints
pnpm install
pnpm build
```

## Related Repositories

| Repository | Description |
|:--|:--|
| [kompojs/kompo](https://github.com/kompojs/kompo) | CLI, kit, config, core runtime |
| [kompojs/create-kompo](https://github.com/kompojs/create-kompo) | `create-kompo` scaffolder |
| [kompojs/workbench](https://github.com/kompojs/workbench) | Visual architecture explorer |

## Contributing

We welcome blueprint contributions! Whether it's a new framework, design system, or adapter:

1. Fork this repo
2. Create your blueprint package under `packages/`
3. Add a `kompo.blueprint.json` manifest
4. Add your templates in `elements/` and starters in `starters/`
5. Submit a pull request

See the [Contributing Guide](https://kompo.dev/docs/en/contributing) for details.

## License

**MIT © 2026 SmarttDev and Kompo contributors**
