import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import { simpleGit } from 'simple-git';
import { glob } from 'glob';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FileNode {
  id: string;
  path: string;
  name: string;
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
    // Get commit count per file (last 100 commits for speed)
    const log = await git.log(['--oneline', '-100', '--name-only', '--pretty=format:']);
    
    const fileCommitCount: Record<string, number> = {};
    
    for (const commit of log.all) {
      const commitAny = commit as any;
      if (commitAny.files) {
        for (const file of commitAny.files) {
          const normalized = path.normalize(file);
          fileCommitCount[normalized] = (fileCommitCount[normalized] || 0) + 1;
        }
      }
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
  ];
  
  let files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: absoluteRoot, absolute: true, ignore });
    files.push(...matches);
  }
  
  // Deduplicate
  files = [...new Set(files)];
  
  spinner.text = `Found ${files.length} files. Analyzing...`;
  
  // Create ts-morph project for AST analysis
  const project = new Project({
    tsConfigFilePath: path.join(absoluteRoot, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  
  const nodes: FileNode[] = [];
  const edges: DependencyEdge[] = [];
  const languages: Record<string, number> = {};
  let totalLOC = 0;
  
  // Get git churn if requested
  const churnMap = options.git !== false ? await getGitChurn(absoluteRoot, files) : {};
  
  for (const filePath of files) {
    try {
      const language = detectLanguage(filePath);
      languages[language] = (languages[language] || 0) + 1;
      
      const sourceFile = project.addSourceFileAtPath(filePath);
      const text = sourceFile.getFullText();
      const loc = text.split('\n').length;
      totalLOC += loc;
      
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
        // Check if ImportExpression exists in this TS version
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
          // Named exports
          const namedExports = exp.getNamedExports();
          for (const ne of namedExports) {
            exports.push(ne.getName());
          }
        }
      }
      
      // Default exports
      const defaultExports = sourceFile.getDefaultExportSymbol();
      if (defaultExports) {
        exports.push('default');
      }
      
      // Export assignments
      const exportAssignments = sourceFile.getExportAssignments();
      for (const ea of exportAssignments) {
        exports.push('default');
      }
      
      const complexity = calculateComplexity(sourceFile);
      const churn = churnMap[filePath] || 0;
      
      // Hotness = combination of complexity, LOC, and churn
      const hotness = Math.min(1, (complexity / 50) * 0.3 + (loc / 1000) * 0.3 + churn * 0.4);
      
      const relativePath = path.relative(absoluteRoot, filePath);
      const id = relativePath.replace(/[\\/]/g, '_').replace(/\./g, '_');
      
      nodes.push({
        id,
        path: relativePath,
        name: path.basename(filePath),
        language,
        loc,
        complexity,
        imports,
        exports,
        churn,
        hotness,
      });
      
      // Build edges (will resolve after all nodes exist)
      for (const imp of imports) {
        edges.push({ from: id, to: imp, type: 'import' });
      }
    } catch (err) {
      // Skip files that can't be parsed
      console.warn(chalk.yellow(`Warning: Could not parse ${filePath}`));
    }
  }
  
  // Resolve edges to actual node IDs
  const nodeMap = new Map(nodes.map(n => [n.path, n.id]));
  
  const resolvedEdges: DependencyEdge[] = [];
  for (const edge of edges) {
    // Try to find the target file
    let targetId: string | null = null;
    
    // Direct path match
    if (nodeMap.has(edge.to)) {
      targetId = nodeMap.get(edge.to)!;
    } else {
      // Try fuzzy match for relative imports
      for (const [nodePath, nodeId] of nodeMap) {
        if (nodePath.endsWith(edge.to) || 
            nodePath === edge.to ||
            nodePath.replace(/\.(ts|tsx|js|jsx|py|rs|go|java)$/, '') === edge.to) {
          targetId = nodeId;
          break;
        }
      }
    }
    
    if (targetId && targetId !== edge.from) {
      resolvedEdges.push({ from: edge.from, to: targetId, type: edge.type });
    }
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