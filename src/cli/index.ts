#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanCommand } from './commands/scan.js';
import { mapCommand } from './commands/map.js';
import { serveCommand } from './commands/serve.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __dirname is dist/cli, so package.json is at ../../package.json
const packageJson = JSON.parse(await fs.readFile(path.join(__dirname, '../../package.json'), 'utf-8'));
const version = packageJson.version;

program
  .name('repomap')
  .description('Visual interactive map of any code repository')
  .version(version)
  .addHelpText('after', `
Examples:
  $ repomap                          # Scan current directory and open map
  $ repomap /path/to/repo            # Scan specific repository
  $ repomap --serve                  # Start local server with live reload
  $ repomap --output map.html        # Export static HTML
  $ repomap --filter "*.ts,*.js"     # Only TypeScript/JavaScript files
`);

program
  .command('scan')
  .description('Scan repository and output JSON graph')
  .argument('[path]', 'Repository path', process.cwd())
  .option('-o, --output <file>', 'Output JSON file')
  .option('--no-git', 'Skip git churn analysis')
  .action(async (repoPath, options) => {
    await scanCommand(repoPath, options);
  });

program
  .command('map')
  .description('Generate interactive HTML map')
  .argument('[path]', 'Repository path', process.cwd())
  .option('-o, --output <file>', 'Output HTML file')
  .option('--serve', 'Start local server after generating')
  .option('--port <number>', 'Server port', '3456')
  .action(async (repoPath, options) => {
    await mapCommand(repoPath, options);
  });

program
  .command('serve')
  .description('Start local server with live reload')
  .argument('[path]', 'Repository path', process.cwd())
  .option('-p, --port <number>', 'Server port', '3456')
  .action(async (repoPath, options) => {
    await serveCommand(repoPath, options);
  });

// Default command: scan + generate map + open
program
  .argument('[path]', 'Repository path', process.cwd())
  .option('-o, --output <file>', 'Output HTML file')
  .option('-s, --serve', 'Start local server')
  .option('-p, --port <number>', 'Server port', '3456')
  .option('--no-git', 'Skip git churn analysis')
  .option('--filter <globs>', 'File glob patterns (comma-separated)')
  .action(async (repoPath, opts) => {
    await mapCommand(repoPath, {
      output: opts.output,
      serve: opts.serve,
      port: parseInt(opts.port),
      git: opts.git,
      filter: opts.filter?.split(',') ?? []
    });
  });

program.parseAsync(process.argv).catch(err => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});