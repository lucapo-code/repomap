import { scanRepository, RepoGraph } from './scan.js';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read D3.js locally so the HTML is fully standalone/offline
// __dirname is dist/cli/commands, so node_modules is at ../../../node_modules
const d3Path = path.join(__dirname, '../../../node_modules/d3/dist/d3.min.js');
let D3_SOURCE = '';
try {
  D3_SOURCE = await fs.readFile(d3Path, 'utf-8');
} catch {
  // Fallback: try require.resolve from project root
  try {
    const { createRequire } = await import('module');
    const req = createRequire(path.join(__dirname, '../../../package.json'));
    D3_SOURCE = await fs.readFile(req.resolve('d3/dist/d3.min.js'), 'utf-8');
  } catch {
    D3_SOURCE = '';
  }
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>repomap - {{repoName}}</title>
  <script>${D3_SOURCE || ''}</script>
  ${D3_SOURCE ? '' : '<script src="https://d3js.org/d3.v7.min.js"></script>'}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; overflow: hidden; height: 100vh; }
    #canvas { width: 100%; height: 100%; position: relative; }
    #ui { position: fixed; top: 16px; left: 16px; right: 16px; z-index: 100; display: flex; gap: 12px; flex-wrap: wrap; }
    .panel { background: rgba(22, 27, 34, 0.95); border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; backdrop-filter: blur(8px); }
    .panel h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #8b949e; margin-bottom: 8px; }
    .stats { display: flex; gap: 24px; font-size: 13px; }
    .stat { display: flex; flex-direction: column; }
    .stat-value { font-size: 20px; font-weight: 700; color: #58a6ff; }
    .stat-label { font-size: 11px; color: #8b949e; }
    .controls { display: flex; gap: 8px; align-items: center; }
    .btn { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.15s; }
    .btn:hover { background: #30363d; border-color: #484f58; }
    .btn.primary { background: #238636; border-color: #238636; }
    .btn.primary:hover { background: #2ea043; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .filter-group { display: flex; gap: 8px; align-items: center; }
    .filter-group label { font-size: 12px; color: #8b949e; }
    .filter-group select { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 6px 10px; border-radius: 6px; font-size: 12px; }
    .filter-group input[type="range"] { accent-color: #58a6ff; width: 120px; }
    #search { background: #21262d; border: 1px solid #30363d; color: #e6edf3; padding: 6px 12px; border-radius: 6px; font-size: 13px; width: 200px; }
    #search:focus { outline: none; border-color: #58a6ff; }
    #legend { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #8b949e; }
    .legend-color { width: 12px; height: 12px; border-radius: 3px; }
    #sidebar { position: fixed; top: 80px; right: 16px; bottom: 16px; width: 320px; background: rgba(22, 27, 34, 0.95); border: 1px solid #30363d; border-radius: 8px; padding: 16px; overflow-y: auto; z-index: 50; display: none; }
    #sidebar.open { display: block; }
    .file-info h4 { font-size: 14px; margin-bottom: 4px; color: #e6edf3; }
    .file-info .path { font-size: 11px; color: #8b949e; margin-bottom: 12px; font-family: monospace; }
    .file-info .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; }
    .file-info .meta-item { background: #161b22; padding: 8px; border-radius: 6px; border: 1px solid #30363d; }
    .file-info .meta-label { color: #8b949e; font-size: 11px; }
    .file-info .meta-value { color: #e6edf3; font-weight: 500; }
    .file-info .deps { margin-top: 16px; }
    .file-info .deps h5 { font-size: 11px; color: #8b949e; margin-bottom: 8px; text-transform: uppercase; }
    .file-info .dep-list { max-height: 200px; overflow-y: auto; }
    .file-info .dep-item { font-size: 12px; color: #c9d1d9; padding: 4px 8px; background: #161b22; margin-bottom: 4px; border-radius: 4px; border: 1px solid #30363d; font-family: monospace; }
    .node { cursor: pointer; transition: opacity 0.15s; }
    .node:hover { opacity: 0.8; }
    .node.selected { filter: drop-shadow(0 0 8px #58a6ff); }
    .node circle { stroke: #161b22; stroke-width: 1.5px; }
    .link { stroke: #30363d; stroke-opacity: 0.4; stroke-width: 0.8px; pointer-events: none; }
    .link:hover { stroke: #58a6ff; stroke-opacity: 0.8; stroke-width: 1.5px; }
    .cluster { fill: none; stroke: #30363d; stroke-width: 1px; stroke-dasharray: 4,4; opacity: 0.5; }
    .cluster-label { font-size: 11px; fill: #8b949e; font-weight: 600; pointer-events: none; }
    .toolbar { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; z-index: 100; }
    .zoom-controls { display: flex; gap: 4px; }
    .zoom-btn { width: 36px; height: 36px; border-radius: 6px; background: rgba(22, 27, 34, 0.95); border: 1px solid #30363d; color: #e6edf3; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .zoom-btn:hover { background: #30363d; }
    @media (max-width: 768px) {
      #ui { top: 8px; left: 8px; right: 8px; }
      #sidebar { right: 8px; left: 8px; top: auto; bottom: 8px; height: 40%; width: auto; max-height: 50vh; }
      .stats { gap: 16px; }
    }
  </style>
</head>
<body>
  <div id="ui">
    <div class="panel">
      <h3>Repository</h3>
      <div class="stats" id="repoStats"></div>
    </div>
    <div class="panel controls">
      <div class="filter-group">
        <label>Language</label>
        <select id="langFilter"><option value="">All</option></select>
      </div>
      <div class="filter-group">
        <label>Min Hotness</label>
        <input type="range" id="hotnessFilter" min="0" max="1" step="0.05" value="0">
        <span id="hotnessValue">0</span>
      </div>
      <input type="search" id="search" placeholder="Search files...">
      <button class="btn primary" id="exportBtn">Export PNG</button>
      <button class="btn" id="sidebarToggle">Details</button>
    </div>
    <div class="panel" id="legend"></div>
  </div>

  <div id="canvas"></div>

  <div id="sidebar">
    <div class="file-info" id="fileInfo">
      <p style="color: #8b949e; text-align: center; padding: 40px;">Click a node to see details</p>
    </div>
  </div>

  <div class="toolbar">
    <div class="zoom-controls">
      <button class="zoom-btn" id="zoomIn" title="Zoom In">+</button>
      <button class="zoom-btn" id="zoomOut" title="Zoom Out">−</button>
      <button class="zoom-btn" id="zoomReset" title="Reset View">⌂</button>
    </div>
  </div>

  <script>
    // Data will be injected here
    const GRAPH_DATA = {{graphData}};
    
    // Color scheme by language
    const LANG_COLORS = {
      'TypeScript': '#3178c6',
      'JavaScript': '#f7df1e',
      'Python': '#3776ab',
      'Rust': '#dea584',
      'Go': '#00add8',
      'Java': '#ed8b00',
      'C++': '#00599c',
      'C': '#a8b9cc',
      'C#': '#239120',
      'PHP': '#777bb4',
      'Ruby': '#cc342d',
      'Swift': '#fa7343',
      'Kotlin': '#7f52ff',
      'Scala': '#dc322f',
      'HTML': '#e34f26',
      'CSS': '#1572b6',
      'JSON': '#292929',
      'YAML': '#cb171e',
      'Markdown': '#083fa1',
      'Shell': '#4eaa25',
      'Dockerfile': '#2496ed',
      'SQL': '#e38c00',
      'GraphQL': '#e10098',
      'Protobuf': '#a855f7',
      'Vue': '#42b883',
      'Svelte': '#ff3e00',
    };
    
    const DEFAULT_COLOR = '#6e7681';
    
    function getColor(lang) {
      return LANG_COLORS[lang] || DEFAULT_COLOR;
    }
    
    // Initialize
    const canvas = document.getElementById('canvas');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    const svg = d3.select('#canvas')
      .append('svg')
      .attr('width', width)
      .attr('height', height);
    
    const g = svg.append('g');
    
    // Zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    
    svg.call(zoom);
    
    // Force simulation
    const simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(80).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => Math.max(8, Math.sqrt(d.loc)) + 4).strength(0.7))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05));
    
    // Tooltip
    const tooltip = d3.select('body')
      .append('div')
      .style('position', 'absolute')
      .style('background', '#161b22')
      .style('border', '1px solid #30363d')
      .style('border-radius', '6px')
      .style('padding', '8px 12px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 1000)
      .style('box-shadow', '0 8px 24px rgba(0,0,0,0.4)');
    
    // Build language filter options
    const languages = [...new Set(GRAPH_DATA.nodes.map(n => n.language))].sort();
    const langSelect = document.getElementById('langFilter');
    languages.forEach(lang => {
      const opt = document.createElement('option');
      opt.value = lang;
      opt.textContent = lang;
      langSelect.appendChild(opt);
    });
    
    // Build legend
    const legend = document.getElementById('legend');
    languages.forEach(lang => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = '<div class="legend-color" style="background:' + getColor(lang) + '"></div><span>' + lang + '</span>';
      legend.appendChild(item);
    });
    
    // Initialize repo stats
    function updateStats() {
      const visibleNodes = nodes.filter(n => n.visible);
      const stats = document.getElementById('repoStats');
      stats.innerHTML = 
        '<div class="stat"><span class="stat-value">' + visibleNodes.length + '</span><span class="stat-label">Files</span></div>' +
        '<div class="stat"><span class="stat-value">' + d3.sum(visibleNodes, d => d.loc) + '</span><span class="stat-label">LOC</span></div>' +
        '<div class="stat"><span class="stat-value">' + GRAPH_DATA.metadata.languages + '</span><span class="stat-label">Languages</span></div>' +
        '<div class="stat"><span class="stat-value">' + GRAPH_DATA.edges.filter(e => 
          nodes.find(n => n.id === e.source)?.visible && nodes.find(n => n.id === e.target)?.visible
        ).length + '</span><span class="stat-label">Dependencies</span></div>';
    }
    
    // Render graph
    let nodes = GRAPH_DATA.nodes.map(n => ({ ...n, visible: true }));
    let links = GRAPH_DATA.edges.map(e => ({ ...e, source: e.from, target: e.to }));
    
    function render() {
      // Filter nodes
      const langFilter = langSelect.value;
      const hotnessFilter = parseFloat(document.getElementById('hotnessFilter').value);
      const searchTerm = document.getElementById('search').value.toLowerCase();
      
      nodes.forEach(n => {
        n.visible = (!langFilter || n.language === langFilter) &&
                    n.hotness >= hotnessFilter &&
                    (!searchTerm || n.name.toLowerCase().includes(searchTerm) || n.path.toLowerCase().includes(searchTerm));
      });
      
      // Update hotness value display
      document.getElementById('hotnessValue').textContent = hotnessFilter.toFixed(2);
      
      // Filter links
      const visibleNodeIds = new Set(nodes.filter(n => n.visible).map(n => n.id));
      const visibleLinks = links.filter(l => visibleNodeIds.has(l.source.id || l.source) && visibleNodeIds.has(l.target.id || l.target));
      const visibleNodesArr = nodes.filter(n => n.visible);
      
      // Update simulation
      simulation.nodes(visibleNodesArr);
      simulation.force('link').links(visibleLinks);
      
      // Render links
      const link = g.selectAll('.link')
        .data(visibleLinks, d => d.source.id + '-' + d.target.id);
      
      link.exit().remove();
      
      const linkEnter = link.enter()
        .append('line')
        .attr('class', 'link');
      
      link.merge(linkEnter);
      
      // Render nodes
      const node = g.selectAll('.node')
        .data(visibleNodesArr, d => d.id);
      
      node.exit().remove();
      
      const nodeEnter = node.enter()
        .append('g')
        .attr('class', 'node')
        .call(drag(simulation));
      
      nodeEnter.append('circle')
        .attr('r', d => Math.max(6, Math.sqrt(d.loc) * 0.8))
        .attr('fill', d => getColor(d.language))
        .attr('opacity', 0.9);
      
      nodeEnter.append('text')
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#fff')
        .attr('pointer-events', 'none')
        .text(d => d.name.length > 12 ? d.name.slice(0, 10) + '..' : d.name);
      
      const nodeMerged = node.merge(nodeEnter);
      
      nodeMerged
        .on('mouseover', (event, d) => {
          tooltip.style('opacity', 1)
            .html('<strong>' + d.name + '</strong><br/>' + d.path + '<br/>LOC: ' + d.loc + ' | Complexity: ' + d.complexity + ' | Hotness: ' + (d.hotness * 100).toFixed(0) + '%')
            .style('left', (event.pageX + 12) + 'px')
            .style('top', (event.pageY - 28) + 'px');
        })
        .on('mousemove', (event) => {
          tooltip.style('left', (event.pageX + 12) + 'px')
            .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', () => tooltip.style('opacity', 0))
        .on('click', (event, d) => showFileInfo(d));
      
      // Highlight selected
      nodeMerged.classed('selected', d => d.id === selectedNodeId);
      
      simulation.on('tick', () => {
        link.merge(linkEnter)
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        
        nodeMerged.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
      });
      
      // Restart simulation
      simulation.alpha(0.3).restart();
      updateStats();
    }
    
    // Drag behavior
    function drag(simulation) {
      return d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        });
    }
    
    let selectedNodeId = null;
    
    function showFileInfo(node) {
      selectedNodeId = node.id;
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.add('open');
      
      const incoming = links.filter(l => (l.target.id || l.target) === node.id).map(l => l.source.name || l.source);
      const outgoing = links.filter(l => (l.source.id || l.source) === node.id).map(l => l.target.name || l.target);
      
      document.getElementById('fileInfo').innerHTML = 
        '<h4>' + node.name + '</h4>' +
        '<div class="path">' + node.path + '</div>' +
        '<div class="meta">' +
        '<div class="meta-item"><div class="meta-label">Language</div><div class="meta-value" style="color:' + getColor(node.language) + '">' + node.language + '</div></div>' +
        '<div class="meta-item"><div class="meta-label">Lines of Code</div><div class="meta-value">' + node.loc.toLocaleString() + '</div></div>' +
        '<div class="meta-item"><div class="meta-label">Complexity</div><div class="meta-value">' + node.complexity + '</div></div>' +
        '<div class="meta-item"><div class="meta-label">Hotness</div><div class="meta-value">' + (node.hotness * 100).toFixed(0) + '%</div></div>' +
        '<div class="meta-item"><div class="meta-label">Git Churn</div><div class="meta-value">' + (node.churn * 100).toFixed(0) + '%</div></div>' +
        '<div class="meta-item"><div class="meta-label">Exports</div><div class="meta-value">' + node.exports.length + '</div></div>' +
        '</div>' +
        '<div class="deps">' +
        '<h5>Imports (' + incoming.length + ')</h5>' +
        '<div class="dep-list">' + incoming.slice(0, 30).map(i => '<div class="dep-item">← ' + i + '</div>').join('') + (incoming.length > 30 ? '<div class="dep-item" style="color:#8b949e">... and ' + (incoming.length - 30) + ' more</div>' : '') + '</div>' +
        '<h5 style="margin-top:12px">Imported by (' + outgoing.length + ')</h5>' +
        '<div class="dep-list">' + outgoing.slice(0, 30).map(o => '<div class="dep-item">→ ' + o + '</div>').join('') + (outgoing.length > 30 ? '<div class="dep-item" style="color:#8b949e">... and ' + (outgoing.length - 30) + ' more</div>' : '') + '</div>' +
        '</div>';
      
      render(); // Re-render to update selection highlight
    }
    
    // Event listeners
    document.getElementById('langFilter').addEventListener('change', render);
    document.getElementById('hotnessFilter').addEventListener('input', render);
    document.getElementById('search').addEventListener('input', render);
    
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
    
    document.getElementById('zoomIn').addEventListener('click', () => svg.transition().duration(300).call(zoom.scaleBy, 1.5));
    document.getElementById('zoomOut').addEventListener('click', () => svg.transition().duration(300).call(zoom.scaleBy, 1/1.5));
    document.getElementById('zoomReset').addEventListener('click', () => svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity));
    
    document.getElementById('exportBtn').addEventListener('click', () => {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svg.node());
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const link = document.createElement('a');
        link.download = 'repomap.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      };
      img.src = url;
    });
    
    // Handle resize
    window.addEventListener('resize', () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      svg.attr('width', w).attr('height', h);
      simulation.force('center', d3.forceCenter(w / 2, h / 2));
      simulation.force('x', d3.forceX(w / 2).strength(0.05));
      simulation.force('y', d3.forceY(h / 2).strength(0.05));
      simulation.alpha(0.3).restart();
    });
    
    // Initial render
    render();
  </script>
</body>
</html>`;

export async function mapCommand(
  repoPath: string,
  options: { output?: string; serve?: boolean; port?: number; git?: boolean; filter?: string[] } = {}
) {
  const spinner = ora('Generating repository map...').start();
  
  const graph = await scanRepository(repoPath, { filter: options.filter, git: options.git });
  
  // Inject graph data into template
  const repoName = path.basename(path.resolve(repoPath));
  const html = HTML_TEMPLATE
    .replace('{{repoName}}', repoName)
    .replace('{{graphData}}', JSON.stringify(graph));
  
  let outputPath = options.output;
  if (!outputPath) {
    outputPath = path.join(process.cwd(), 'repomap.html');
  }
  
  await fs.writeFile(outputPath, html);
  spinner.succeed(chalk.green(`Map written to ${outputPath}`));
  
  if (options.serve) {
    await serveMap(outputPath, options.port ?? 3456);
  } else {
    console.log(chalk.cyan('\nOpen in browser:'), 'file://' + outputPath);
    console.log(chalk.gray('Or run: repomap --serve'));
  }
  
  return graph;
}

async function serveMap(htmlPath: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        if (req.url === '/' || req.url === '/index.html') {
          const html = await fs.readFile(htmlPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        } else if (req.url === '/data.json') {
          // Could serve graph data separately
          res.writeHead(404);
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      } catch (err) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
    
    server.listen(port, () => {
      console.log(chalk.cyan(`\nServer running at http://localhost:${port}`));
      console.log(chalk.gray('Press Ctrl+C to stop'));
      
      // Open browser
      open(`http://localhost:${port}`).catch(() => {});
    });
    
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(chalk.yellow(`Port ${port} in use, trying ${port + 1}...`));
        serveMap(htmlPath, port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    
    process.on('SIGINT', () => {
      server.close(() => {
        console.log(chalk.gray('\nServer stopped'));
        resolve();
      });
    });
  });
}

export async function serveCommand(repoPath: string, options: { port?: number } = {}) {
  // Generate map first, then serve
  await mapCommand(repoPath, { serve: true, port: options.port });
}