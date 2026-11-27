# repomap

> **Visual interactive map of any code repository** — buildings = files, streets = dependencies, heatmap = git churn

```
npx repomap                    # Scan current directory, open interactive map
npx repomap /path/to/repo      # Scan specific repository
npx repomap --serve            # Start local server with live reload
npx repomap --output map.html  # Export standalone HTML
```

![repomap demo](https://github.com/lucas/repomap/raw/main/demo.gif)

## Why?

- **Instant understanding** — Drop into any repo and see its architecture in seconds
- **Onboarding** — New team members explore the codebase visually
- **Code review** — Spot circular deps, god files, hidden coupling
- **Refactoring** — Identify hot spots (high complexity + high churn)
- **Shareable** — Single HTML file works offline, embed in READMEs

## Features

| Feature | Description |
|---------|-------------|
| **Multi-language** | TS/JS (AST via ts-morph), Python, Rust, Go, Java, C/C++, C#, PHP, Ruby, Swift, Kotlin, Shell + 40 more via regex extractors |
| **AST + regex analysis** | Accurate imports/exports via `ts-morph` for JS/TS, regex extractors for 11+ other languages |
| **Git churn heatmap** | Files colored by commit frequency (last 100 commits) |
| **Complexity scoring** | Cyclomatic complexity per file |
| **Hotness metric** | Combined score: complexity + LOC + churn |
| **Interactive D3 force graph** | Drag, zoom, filter, search, click for details |
| **Language filter** | Show only TypeScript, only Python, etc. |
| **Export PNG** | One-click screenshot for docs/README |
| **Zero config** | Works out of the box, no config file needed |
| **Standalone HTML** | Single file, no server needed, works offline |
| **Local server** | `--serve` for live reload during development |

## Installation

```bash
# Global (recommended)
npm install -g repomap

# Or use directly
npx repomap

# In a project (for CI/GitHub Actions)
npm install --save-dev repomap
```

## Usage

```bash
# Basic: scan current dir, open map in browser
repomap

# Specific repository
repomap /path/to/my-project

# Generate standalone HTML file
repomap --output architecture.html

# Start local server with live reload
repomap --serve --port 3456

# Filter to specific languages
repomap --filter "*.ts,*.tsx,*.js,*.jsx"

# Skip git analysis (faster, no heatmap)
repomap --no-git

# JSON output for scripting
repomap scan --output graph.json
```

### Commands

| Command | Description |
|---------|-------------|
| `repomap [path]` | Scan + generate map (default) |
| `repomap scan [path]` | Output JSON graph only |
| `repomap map [path]` | Generate HTML map |
| `repomap serve [path]` | Start dev server |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output` | `repomap.html` | Output file path |
| `-s, --serve` | `false` | Start local server |
| `-p, --port` | `3456` | Server port |
| `--no-git` | `false` | Skip git churn analysis |
| `--filter` | `all code files` | Comma-separated glob patterns |

## Example Output

The interactive map shows:

- **Nodes** = files (size = LOC, color = language)
- **Edges** = dependencies (imports/requires)
- **Clusters** = directories (auto-grouped)
- **Sidebar** = click any node for details (LOC, complexity, churn, imports, imported-by)
- **Filters** = language dropdown, hotness slider, search box
- **Toolbar** = zoom in/out, reset, export PNG

## GitHub Action

```yaml
# .github/workflows/repomap.yml
name: Generate Architecture Map

on:
  push:
    branches: [main]
  pull_request:

jobs:
  repomap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 100  # needed for git churn
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - run: npx repomap --output repomap.html
      
      - uses: actions/upload-artifact@v4
        with:
          name: repomap
          path: repomap.html
```

## How It Works

1. **Glob discovery** — Finds all code files (respects `.gitignore` patterns)
2. **Language detection** — Maps file extensions to languages
3. **Import extraction** — `ts-morph` AST for JS/TS, regex-based extractors for Python/Rust/Go/Java/C/C++/Ruby/PHP/C#/Swift/Kotlin/Shell
4. **Import resolution** — Language-aware: Python relative dots, Rust `crate::`/`super::`, Go module paths, JS relative paths
5. **Git analysis** — `simple-git` counts commits per file (last 100)
6. **Graph construction** — Nodes + edges with progressive path resolution
7. **D3 force layout** — Physics-based positioning, clusters by directory
8. **HTML injection** — Embeds graph data in standalone HTML template

## Architecture

```
repomap/
├── src/
│   ├── cli/
│   │   ├── index.ts           # Commander CLI entry
│   │   ├── extractors.ts      # Multi-language regex import/complexity extractors
│   │   └── commands/
│   │       ├── scan.ts        # Repository scanning + import resolution
│   │       ├── map.ts         # HTML generation + D3 template
│   │       └── serve.ts       # Local dev server
│   └── types.ts               # Shared interfaces
├── package.json
├── tsconfig.json
└── README.md
```

## Requirements

- **Node.js 18+**
- **Git** (optional, for churn heatmap)

## Performance

| Repo Size | Files | Scan Time |
|-----------|-------|-----------|
| Small     | < 100 | ~2s       |
| Medium    | 100-500 | ~5s     |
| Large     | 500-2000 | ~15s   |
| Huge      | 2000+ | ~30s+     |

*First run slower (ts-morph loads), subsequent runs faster with cache.*

## Contributing

```bash
git clone https://github.com/lucas/repomap
cd repomap
npm install
npm run dev          # Watch mode
npm run build        # Compile
npm test             # Vitest
npm run lint         # ESLint
```

## Roadmap

- [ ] VS Code extension (sidebar view)
- [ ] GitHub Action for PR comments with map diff
- [ ] Circular dependency detection
- [ ] Architecture metrics dashboard
- [ ] Monorepo workspace support
- [ ] Custom color themes
- [ ] Export to Mermaid/PlantUML
- [ ] WebAssembly build for browser-only usage

## License

MIT © Lucas

---

*Built with [ts-morph](https://ts-morph.com), [D3.js](https://d3js.org), [simple-git](https://github.com/steveukx/git-js), and lots of ☕*