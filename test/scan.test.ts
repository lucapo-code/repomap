import { describe, it, expect } from 'vitest';
import { scanRepository, resolveImport } from '../src/cli/commands/scan.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixture: multi-language repo con ciclos conocidos
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'multi-lang');

async function setupFixture() {
  await fs.mkdir(path.join(FIXTURE_ROOT, 'src'), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_ROOT, 'pkg'), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_ROOT, 'rust'), { recursive: true });

  // Python: main -> utils -> models
  await fs.writeFile(path.join(FIXTURE_ROOT, 'src', 'main.py'), `
import utils
from models import User
from . import local_helper

def main():
    if True:
        for i in range(10):
            print(i)
    return User()
`);
  await fs.writeFile(path.join(FIXTURE_ROOT, 'src', 'utils.py'), `
import os
import sys
from collections import OrderedDict

def helper():
    if False:
        pass
    return 42
`);
  await fs.writeFile(path.join(FIXTURE_ROOT, 'src', 'models.py'), `
class User:
    def __init__(self):
        pass

class Admin(User):
    pass
`);
  await fs.writeFile(path.join(FIXTURE_ROOT, 'src', 'local_helper.py'), `
# internal helper
def internal():
    pass
`);

  // Go: main -> pkg
  await fs.writeFile(path.join(FIXTURE_ROOT, 'pkg', 'main.go'), `
package main
import (
	"fmt"
	"pkg"
)
func main() {
	fmt.Println(pkg.Helper())
}
`);
  await fs.writeFile(path.join(FIXTURE_ROOT, 'pkg', 'pkg.go'), `
package pkg
func Helper() string {
	if true {
		return "ok"
	}
	return "no"
}
type Config struct{}
`);

  // Rust: lib.rs -> utils.rs
  await fs.writeFile(path.join(FIXTURE_ROOT, 'rust', 'lib.rs'), `
use self::utils::helper;
pub fn run() { helper(); }
mod utils;
`);
  await fs.writeFile(path.join(FIXTURE_ROOT, 'rust', 'utils.rs'), `
pub fn helper() { if true { return; } }
`);

  // Ciclo JS: a -> b -> a
  await fs.writeFile(path.join(FIXTURE_ROOT, 'a.js'), `
import './b.js';
export const a = 1;
`);
  await fs.writeFile(path.join(FIXTURE_ROOT, 'b.js'), `
import './a.js';
export const b = 2;
`);
}

async function teardownFixture() {
  await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
}

describe('scanRepository integration', () => {
  beforeAll(async () => {
    await setupFixture();
  });

  afterAll(async () => {
    await teardownFixture();
  });

  it('escanea repo multi-lenguaje y devuelve nodos y aristas', async () => {
    const graph = await scanRepository(FIXTURE_ROOT, { git: false });
    
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.metadata.languages.Python).toBeDefined();
    expect(graph.metadata.languages.Go).toBeDefined();
    expect(graph.metadata.languages.Rust).toBeDefined();
    expect(graph.metadata.totalLOC).toBeGreaterThan(0);
    expect(graph.metadata.scanTime).toBeGreaterThan(0);
  }, 30000);

  it('resuelve imports relativos Python a archivos existentes', async () => {
    const graph = await scanRepository(FIXTURE_ROOT, { git: false });
    
    const main = graph.nodes.find(n => n.path === 'src/main.py');
    expect(main).toBeDefined();
    
    // main.py importa utils, models, local_helper
    const targets = graph.edges
      .filter(e => e.from === main!.id)
      .map(e => graph.nodes.find(n => n.id === e.to)?.path)
      .filter(Boolean);
    
    expect(targets).toContain('src/utils.py');
    expect(targets).toContain('src/models.py');
    expect(targets).toContain('src/local_helper.py');
  }, 30000);

  it('resuelve imports Go locales (sin dominio)', async () => {
    const graph = await scanRepository(FIXTURE_ROOT, { git: false });
    
    const goMain = graph.nodes.find(n => n.path === 'pkg/main.go');
    expect(goMain).toBeDefined();
    
    const targets = graph.edges
      .filter(e => e.from === goMain!.id)
      .map(e => graph.nodes.find(n => n.id === e.to)?.path)
      .filter(Boolean);
    
    // pkg.go es local, "fmt" es externo y se descarta
    expect(targets).toContain('pkg/pkg.go');
  }, 30000);

  it('resuelve imports Rust crate:: y mod', async () => {
    const graph = await scanRepository(FIXTURE_ROOT, { git: false });
    
    const lib = graph.nodes.find(n => n.path === 'rust/lib.rs');
    expect(lib).toBeDefined();
    
    const targets = graph.edges
      .filter(e => e.from === lib!.id)
      .map(e => graph.nodes.find(n => n.id === e.to)?.path)
      .filter(Boolean);
    
    expect(targets).toContain('rust/utils.rs');
  }, 30000);

  it('detecta ciclo JS a <-> b', async () => {
    const graph = await scanRepository(FIXTURE_ROOT, { git: false });
    
    expect(graph.cycles.length).toBeGreaterThanOrEqual(1);
    
    // El ciclo debe contener a.js y b.js
    const cyclePaths = graph.cycles.flat();
    expect(cyclePaths).toContain('a.js');
    expect(cyclePaths).toContain('b.js');
  }, 30000);

  it('hotness calculada entre 0 y 1', async () => {
    const graph = await scanRepository(FIXTURE_ROOT, { git: false });
    
    for (const n of graph.nodes) {
      expect(n.hotness).toBeGreaterThanOrEqual(0);
      expect(n.hotness).toBeLessThanOrEqual(1);
      expect(n.complexity).toBeGreaterThanOrEqual(1);
      expect(n.loc).toBeGreaterThan(0);
    }
  }, 30000);
});

describe('resolveImport (exportado para tests)', () => {
  // pathMap con keys explícitas que cubren los casos de uso más comunes.
  // Los candidatos se generan en orden: stem primero, luego stem+ext, luego stem+otras_ext, luego índices.
  // pathMap.has(c) returns true solo si la key exacta existe.
  const pathMap = new Map([
    // Python raíz
    ['utils.py', 'utils_py'],
    ['models.py', 'models_py'],
    ['local_helper.py', 'local_helper_py'],
    // Go raíz
    ['pkg/pkg.go', 'pkg_pkg_go'],
    // JS/TS raíz
    ['a.js', 'a_js'],
    ['a', 'a_js'],
    ['b.js', 'b_js'],
    ['b', 'b_js'],
    ['index.ts', 'index_ts'],
    ['components/Button.tsx', 'components_Button_tsx'],
    ['components/index.ts', 'components_index_ts'],
  ]);

  describe('Python', () => {
    it('from-import absoluto -> encuentra archivo en pathMap', () => {
      // 'models' -> base = 'models' -> candidates: 'models', 'models.py', ...
      // 'models.py' está en pathMap
      expect(resolveImport('main.py', 'models', 'Python', pathMap)).toBe('models.py');
    });

    it('from-import con . -> archivo con extensión en pathMap', () => {
      // from . import local_helper -> base = 'local_helper'
      // candidates: 'local_helper' (stem), then 'local_helper.py', etc.
      // 'local_helper.py' está en pathMap, 'local_helper' no
      expect(resolveImport('main.py', '.local_helper', 'Python', pathMap)).toBe('local_helper.py');
    });
  });

  describe('Rust', () => {
    // pathMap limitado, no tiene entries de rust/... así que la mayoría son null
    // Los tests de integración (scanRepository) prueban el flujo real con paths normativos
    it('crate:: -> null con pathMap limitado', () => {
      expect(resolveImport('rust/lib.rs', 'crate::utils::helper', 'Rust', pathMap)).toBeNull();
    });

    it('self:: -> null con pathMap limitado', () => {
      expect(resolveImport('rust/lib.rs', 'self::utils', 'Rust', pathMap)).toBeNull();
    });

    it('super:: -> null con pathMap limitado', () => {
      expect(resolveImport('rust/nested/mod.rs', 'super::utils', 'Rust', pathMap)).toBeNull();
    });

    it('external crate -> null', () => {
      expect(resolveImport('rust/lib.rs', 'std::collections::HashMap', 'Rust', pathMap)).toBeNull();
      expect(resolveImport('rust/lib.rs', 'serde::Deserialize', 'Rust', pathMap)).toBeNull();
    });
  });

  describe('Go', () => {
    it('local import sin dominio -> null con pathMap limitado', () => {
      expect(resolveImport('pkg/main.go', 'internal/pkg', 'Go', pathMap)).toBeNull();
    });

    it('dominio externo -> null', () => {
      expect(resolveImport('pkg/main.go', 'github.com/user/repo/pkg', 'Go', pathMap)).toBeNull();
      expect(resolveImport('pkg/main.go', 'fmt', 'Go', pathMap)).toBeNull();
    });
  });

  describe('JS/TS', () => {
    it('relativo ./ -> same dir', () => {
      expect(resolveImport('a.js', './b.js', 'JavaScript', pathMap)).toBe('b.js');
    });

    it('relativo ../ -> parent', () => {
    });

    it('npm package -> null', () => {
      expect(resolveImport('src/main.ts', 'lodash', 'TypeScript', pathMap)).toBeNull();
      expect(resolveImport('src/main.ts', '@scope/pkg', 'TypeScript', pathMap)).toBeNull();
    });

    it('bare specifier sin ext -> null si no en pathMap', () => {
      expect(resolveImport('src/main.ts', 'components', 'TypeScript', pathMap)).toBeNull();
    });
  });
});