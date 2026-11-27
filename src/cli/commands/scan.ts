import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import { simpleGit } from 'simple-git';
import { glob } from 'glob';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractByLanguage } from '../extractors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FileNode {
  id: string;
  path: string;
  name: string;
  /** Directory of the file relative to the repo root, '.' for top-level files */
  dir: string;
  language: string;
  loc: number;
  complexity: number;
  imports: string[];
  exports: string[];
  churn: number;
  hotness: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'require' | 'dynamic';
}

export interface RepoGraph {
  nodes: FileNode[];
  edges: DependencyEdge[];
  metadata: {
    rootPath: string;
    totalFiles: number;
    totalLOC: number;
    languages: Record<string, number>;
    scanTime: number;
  };
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.c': 'C',
  '.h': 'C',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.clj': 'Clojure',
  '.hs': 'Haskell',
  '.ml': 'OCaml',
  '.fs': 'F#',
  '.dart': 'Dart',
  '.lua': 'Lua',
  '.pl': 'Perl',
  '.pm': 'Perl',
  '.r': 'R',
  '.jl': 'Julia',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.hrl': 'Erlang',
  '.zig': 'Zig',
  '.nim': 'Nim',
  '.cr': 'Crystal',
  '.v': 'V',
  '.sol': 'Solidity',
  '.move': 'Move',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.ini': 'INI',
  '.cfg': 'Config',
  '.conf': 'Config',
  '.md': 'Markdown',
  '.txt': 'Text',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.fish': 'Fish',
  '.ps1': 'PowerShell',
  '.bat': 'Batch',
  '.cmd': 'Batch',
  '.dockerfile': 'Dockerfile',
  '.sql': 'SQL',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.proto': 'Protobuf',
  '.thrift': 'Thrift',
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || 'Unknown';
}

function calculateComplexity(sourceFile: SourceFile): number {
  let complexity = 1; // Base complexity
  
  sourceFile.forEachDescendant(node => {
    switch (node.getKind()) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.ConditionalExpression:
      case SyntaxKind.SwitchStatement:
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.CatchClause:
      case SyntaxKind.CaseClause:
      case SyntaxKind.DefaultClause:
      case SyntaxKind.BarBarToken: // ||
      case SyntaxKind.AmpersandAmpersandToken: // &&
      case SyntaxKind.QuestionToken: // ternary
      case SyntaxKind.ExclamationEqualsToken:
      case SyntaxKind.EqualsEqualsEqualsToken:
      case SyntaxKind.ExclamationEqualsEqualsToken:
        complexity += 1;
        break;
    }
  });
  
  return complexity;
}

async function getGitChurn(repoPath: string, filePaths: string[]): Promise<Record<string, number>> {
  const churn: Record<string, number> = {};
  const git = simpleGit(repoPath);
  
  try {
    // Use raw git output; simple-git's parser mis-handles --name-only
    // with --pretty=format, so parse the raw text ourselves.
    const raw = await git.raw(['log', '-100', '--name-only', '--pretty=format:%x00']);
    
    const fileCommitCount: Record<string, number> = {};
    
    // Split on NUL: first block is the commit hashes, then filenames
    // Actually simple-git joins commits; instead split per-commit by matching
    // lines that look like paths (no leading whitespace, not empty, not a hash)
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '\x00') continue;
      // Skip the commit hash lines (40 hex chars, or short 7-8)
      if (/^[0-9a-f]{7,40}$/.test(trimmed)) continue;
      // A changed file path
      const normalized = path.normalize(trimmed);
      fileCommitCount[normalized] = (fileCommitCount[normalized] || 0) + 1;
    }
    
    // Normalize to 0-1 scale
    const maxCommits = Math.max(...Object.values(fileCommitCount), 1);
    
    for (const filePath of filePaths) {
      const relative = path.relative(repoPath, filePath);
      const normalized = path.normalize(relative);
      churn[filePath] = (fileCommitCount[normalized] || 0) / maxCommits;
    }
  } catch {
    // Git not available or not a repo, return zeros
    for (const filePath of filePaths) {
      churn[filePath] = 0;
    }
  }
  
  return churn;
}

export async function scanRepository(
  rootPath: string,
  options: { filter?: string[]; git?: boolean } = {}
): Promise<RepoGraph> {
  const startTime = Date.now();
  const spinner = ora('Scanning repository...').start();
  
  // Resolve absolute path
  const absoluteRoot = path.resolve(rootPath);
  
  // Find all code files
  const patterns = options.filter?.length 
    ? options.filter 
    : ['**/*.{ts,tsx,js,jsx,py,rs,go,java,cpp,cc,cxx,c,h,hpp,cs,php,rb,swift,kt,scala,clj,hs,ml,fs,dart,lua,pl,pm,r,jl,ex,exs,erl,hrl,zig,nim,cr,v,sol,move,css,scss,sass,less,html,htm,vue,svelte,json,yaml,yml,toml,ini,cfg,conf,md,txt,sh,bash,zsh,fish,ps1,bat,cmd,dockerfile,sql,graphql,gql,proto,thrift}'];
  
  const ignore = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/target/**',
    '**/vendor/**',
    '**/__pycache__/**',
    '**/*.min.js',
    '**/*.min.css',
    '**/bower_components/**',
    '**/.idea/**',
    '**/.vscode/**',
    '**/*.log',
    '**/*.lock',
    '**/repomap.html',
    '**/repomap-*.html',
  ];
  
  // Single glob pass instead of one per pattern (much faster on large repos)
  let files: string[] = [];
  {
    const matches = await glob(patterns, { cwd: absoluteRoot, absolute: true, ignore, nodir: true });
    files.push(...matches);
  }
  
  // Deduplicate
  files = [...new Set(files)];
  
  spinner.text = `Found ${files.length} files. Analyzing...`;
  
  // Create ts-morph project for AST analysis.
  // Only point at tsconfig.json when it exists; parsing non-TS files works fine
  // without one (ts-morph falls back to its own default compiler options).
  const tsConfigPath = path.join(absoluteRoot, 'tsconfig.json');
  const project = new Project({
    ...(await fileExists(tsConfigPath) ? { tsConfigFilePath: tsConfigPath } : {}),
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  
  const nodes: FileNode[] = [];
  const edges: DependencyEdge[] = [];
  const languages: Record<string, number> = {};
  let totalLOC = 0;
  
  // Helper: does this path exist as a file?
  async function fileExists(p: string): Promise<boolean> {
    try {
      await fs.stat(p);
      return true;
    } catch {
      return false;
    }
  }

  // Pre-compute normalized relative paths for import resolution
  const pathMap = new Map<string, string>(); // normalized relative path -> id
  for (const filePath of files) {
    const rel = path.relative(absoluteRoot, filePath).split(path.sep).join('/');
    pathMap.set(rel, rel.replace(/[\\/]/g, '_').replace(/\./g, '_'));
  }

  /**
   * Resolve an import specifier (from a given file) to a node path in this repo.
   * Handles relative imports, extensionless, ESM `.js` -> `.ts` mapping, and index files.
   * Returns null for bare package specifiers (node_modules) and anything unresolved.
   */
  function resolveImport(fromRelPath: string, spec: string, language: string): string | null {
    if (!spec) return null;
    let base: string | null = null;

    // Language-specific import patterns
    if (language === 'Python') {
      // Python: from .foo import bar, from .. import baz, import foo.bar
      // Relative imports start with dots
      if (spec.startsWith('.')) {
        const fromDir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : '';
        // Count leading dots
        let dots = 0;
        while (dots < spec.length && spec[dots] === '.') dots++;
        const rest = spec.slice(dots);
        
        // Go up (dots - 1) directories from fromDir
        let baseDir = fromDir;
        for (let i = 1; i < dots; i++) {
          baseDir = baseDir.includes('/') ? baseDir.slice(0, baseDir.lastIndexOf('/')) : '';
        }
        base = path.normalize(path.join(baseDir, rest)).split(path.sep).join('/');
      } else {
        // Absolute import within repo: convert dots to slashes
        base = spec.replace(/\./g, '/');
      }
    } else if (language === 'Rust') {
      // Rust: use crate::foo::bar, use super::foo, use self::foo
      // crate:: maps to src/, super:: goes up, self:: stays
      if (spec.startsWith('crate::')) {
        base = 'src/' + spec.slice(7).replace(/::/g, '/');
      } else if (spec.startsWith('self::')) {
        const fromDir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : '';
        base = path.normalize(path.join(fromDir, spec.slice(6).replace(/::/g, '/'))).split(path.sep).join('/');
      } else if (spec.startsWith('super::')) {
        const fromDir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : '';
        let up = 0;
        let s = spec;
        while (s.startsWith('super::')) { up++; s = s.slice(7); }
        let baseDir = fromDir;
        for (let i = 0; i < up; i++) {
          baseDir = baseDir.includes('/') ? baseDir.slice(0, baseDir.lastIndexOf('/')) : '';
        }
        base = path.normalize(path.join(baseDir, s.replace(/::/g, '/'))).split(path.sep).join('/');
      } else {
        // External crate like std:: or serde:: - skip
        return null;
      }
    } else if (language === 'Go') {
      // Go: imports are module paths like "github.com/user/repo/pkg" or local "internal/util"
      // Only resolve if the path exists in the repo (local import)
      // Skip if it looks like a domain (contains a dot in the first segment)
      const firstSeg = spec.split('/')[0] ?? '';
      if (firstSeg.includes('.')) return null;
      base = spec;
    } else {
      // JS/TS and others: relative ./ ../ or bare
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        const fromDir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : '';
        const joined = path.normalize(path.join(fromDir, spec)).split(path.sep).join('/');
        base = joined;
      } else {
        // Bare specifier: only accept if it matches a repo path exactly (alias imports)
        base = spec.startsWith('src/') || spec.startsWith('./') ? path.normalize(spec).split(path.sep).join('/') : null;
        if (base === null) return null;
      }
    }

    if (base === null) return null;

    const ext = path.extname(base);
    const candidates: string[] = [];
    const stem = ext ? base.slice(0, base.length - ext.length) : base;

    if (ext) candidates.push(base, stem);
    else candidates.push(stem);

    // ESM `.js` / `.mjs` / `.cjs` specifiers map to TS sources
    if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) {
      candidates.push(stem + '.ts', stem + '.tsx', stem + '.d.ts', stem);
    }

    for (const e of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.dart', '.vue', '.svelte', '.css', '.scss', '.less', '.json', '.yaml', '.yml', '.toml', '.md', '.sh']) {
      candidates.push(stem + e);
    }
    for (const idx of ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.json', '__init__.py', 'mod.rs', 'lib.rs']) {
      candidates.push(stem + '/' + idx);
    }

    for (const c of candidates) {
      if (pathMap.has(c)) return c;
    }

    // Rust/Go/Python-style: try progressively shorter path segments
    // crate::utils::helper -> src/utils/helper -> src/utils -> src
    // Python: foo.bar.baz -> foo/bar/baz -> foo/bar -> foo
    const segments = stem.split('/');
    for (let i = segments.length - 1; i > 0; i--) {
      const prefix = segments.slice(0, i).join('/');
      for (const e of ['.rs', '.py', '.go', '.ts', '.js', '.java', '.kt']) {
        if (pathMap.has(prefix + e)) return prefix + e;
      }
      for (const idx of ['mod.rs', '__init__.py', 'index.ts', 'index.js']) {
        if (pathMap.has(prefix + '/' + idx)) return prefix + '/' + idx;
      }
    }

    return null;
  }

  // Get git churn if requested
  const churnMap = options.git !== false ? await getGitChurn(absoluteRoot, files) : {};
  
  // Helper: read file text and extract deps/complexity by language
  async function processFile(filePath: string, language: string): Promise<{ imports: string[]; exports: string[]; complexity: number; loc: number; text: string }> {
    const text = await fs.readFile(filePath, 'utf-8');
    const loc = text.split('\n').length;
    
    if (language === 'TypeScript' || language === 'JavaScript') {
      // Use ts-morph for JS/TS (full AST)
      const sourceFile = project.addSourceFileAtPath(filePath);
      
      // Extract imports
      const imports: string[] = [];
      const importDecls = sourceFile.getImportDeclarations();
      for (const imp of importDecls) {
        const moduleSpec = imp.getModuleSpecifierValue();
        imports.push(moduleSpec);
      }
      
      // Extract requires (CommonJS)
      const requireCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
      for (const call of requireCalls) {
        const expr = call.getExpression();
        if (expr.getText() === 'require') {
          const args = call.getArguments();
          if (args.length > 0) {
            const arg = args[0];
            if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
              imports.push(arg.getText().slice(1, -1));
            }
          }
        }
      }
      
      // Dynamic imports
      try {
        const importExprKind = (SyntaxKind as any).ImportExpression;
        if (importExprKind) {
          const dynamicImports = sourceFile.getDescendantsOfKind(importExprKind);
          for (const dyn of dynamicImports) {
            const args = (dyn as any).getArguments?.();
            if (args?.length > 0) {
              const arg = args[0];
              if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
                imports.push(arg.getText().slice(1, -1));
              }
            }
          }
        }
      } catch {
        // ImportExpression not supported in this TS version
      }
      
      // Extract exports
      const exports: string[] = [];
      const exportDecls = sourceFile.getExportDeclarations();
      for (const exp of exportDecls) {
        const moduleSpec = exp.getModuleSpecifierValue();
        if (moduleSpec) {
          exports.push(moduleSpec);
        } else {
          const namedExports = exp.getNamedExports();
          for (const ne of namedExports) {
            exports.push(ne.getName());
          }
        }
      }
      
      const defaultExports = sourceFile.getDefaultExportSymbol();
      if (defaultExports) {
        exports.push('default');
      }
      
      const exportAssignments = sourceFile.getExportAssignments();
      for (const ea of exportAssignments) {
        exports.push('default');
      }
      
      const complexity = calculateComplexity(sourceFile);
      
      return { imports, exports, complexity, loc, text };
    } else {
      // Use regex extractors for all other languages
      const extracted = extractByLanguage(language, text);
      return { 
        imports: extracted.imports, 
        exports: extracted.exports, 
        complexity: extracted.complexity, 
        loc, 
        text 
      };
    }
  }
  
  for (const filePath of files) {
    try {
      const language = detectLanguage(filePath);
      languages[language] = (languages[language] || 0) + 1;
      
      const { imports, exports, complexity, loc } = await processFile(filePath, language);
      totalLOC += loc;
      
      const churn = churnMap[filePath] || 0;
      
      // Hotness = combination of complexity, LOC, and churn
      const hotness = Math.min(1, (complexity / 50) * 0.3 + (loc / 1000) * 0.3 + churn * 0.4);
      
      const relativePath = path.relative(absoluteRoot, filePath);
      const id = relativePath.replace(/[\\/]/g, '_').replace(/\./g, '_');
      const dir = path.dirname(relativePath).split(path.sep).join('/');
      
      nodes.push({
        id,
        path: relativePath,
        name: path.basename(filePath),
        dir: dir === '' ? '.' : dir,
        language,
        loc,
        complexity,
        imports,
        exports,
        churn,
        hotness,
      });
      
      // Build edges, resolving imports to actual repo files
      const fromRel = path.relative(absoluteRoot, filePath).split(path.sep).join('/');
      for (const imp of imports) {
        const target = resolveImport(fromRel, imp, language);
        if (target) {
          const targetId = pathMap.get(target);
          if (targetId && targetId !== id) {
            edges.push({ from: id, to: targetId, type: imp.startsWith('.') || imp.startsWith('/') ? 'import' : 'require' });
          }
        }
      }
    } catch (err) {
      // Skip files that can't be parsed
      console.warn(chalk.yellow(`Warning: Could not parse ${filePath}`));
    }
  }
  
  const resolvedEdges: DependencyEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = edge.from + '\u0000' + edge.to;
    if (seen.has(key)) continue;
    seen.add(key);
    resolvedEdges.push(edge);
  }
  
  const scanTime = Date.now() - startTime;
  spinner.succeed(chalk.green(`Scanned ${nodes.length} files in ${scanTime}ms`));
  
  return {
    nodes,
    edges: resolvedEdges,
    metadata: {
      rootPath: absoluteRoot,
      totalFiles: nodes.length,
      totalLOC,
      languages,
      scanTime,
    },
  };
}

export async function scanCommand(repoPath: string, options: { output?: string; git?: boolean; filter?: string[] } = {}) {
  const graph = await scanRepository(repoPath, { filter: options.filter, git: options.git });
  
  if (options.output) {
    await fs.writeFile(options.output, JSON.stringify(graph, null, 2));
    console.log(chalk.green(`Graph written to ${options.output}`));
  } else {
    console.log(JSON.stringify(graph, null, 2));
  }
  
  return graph;
}