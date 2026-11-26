import { mapCommand } from './map.js';

export async function serveCommand(repoPath: string, options: { port?: number } = {}) {
  await mapCommand(repoPath, { serve: true, port: options.port });
}