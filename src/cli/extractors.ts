/**
 * Multi-language import/export extractors.
 *
 * ts-morph only understands JS/TS, so for every other language we use
 * targeted regex extraction on the raw source text. It is not a full AST,
 * but for dependency graphs it catches the overwhelming majority of real
 * imports (import statements at line start, the standard forms).
 */

export interface ExtractedDeps {
  imports: string[];
  exports: string[];
  complexity: number;
}

// ---------------------------------------------------------------------------
// Python: `import x`, `import x as y`, `from x import y`, `from . import y`
// ---------------------------------------------------------------------------
function extractPython(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  const lines = src.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip comments and strings-ish lines
    if (line.startsWith('#')) continue;

    // from X import ...  (X may be relative: from .foo import bar, from .. import baz)
    let m = line.match(/^from\s+([.\w]+)\s+import\s+/);
    if (m) {
      imports.push(m[1]!);
      continue;
    }
    // import X, Y, Z
    m = line.match(/^import\s+(.+)$/);
    if (m) {
      // Could be `import a, b` — split on commas not inside parens
      const parts = m[1]!.split(',').map(s => s.trim().split(/\s+as\s+/)[0]!.trim());
      for (const p of parts) {
        if (p && !p.startsWith('(')) imports.push(p);
      }
      continue;
    }
    // def/class at top level (no indent) are "exports" in module terms
    if (/^(def|class)\s+\w+/.test(line) && rawLine[0] !== ' ' && rawLine[0] !== '\t') {
      const name = line.match(/^(?:def|class)\s+(\w+)/);
      if (name) exports.push(name[1]!);
    }
  }

  // Complexity: control-flow keywords
  complexity += countMatches(src, /\b(if|elif|else|for|while|except|finally|with|match|case)\b/g);
  complexity += countMatches(src, /\b(and|or)\b/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// Go: `import "path"` and `import ( "path" ... )`
// ---------------------------------------------------------------------------
function extractGo(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  // Single-line imports
  for (const m of src.matchAll(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm)) {
    imports.push(m[1]!);
  }
  // Block imports: import ( ... )
  for (const blockMatch of src.matchAll(/import\s*\(([\s\S]*?)\)/g)) {
    for (const m of blockMatch[1]!.matchAll(/"([^"]+)"/g)) {
      imports.push(m[1]!);
    }
  }
  // Exported functions/types: func Name( / type Name ...
  for (const m of src.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm)) {
    exports.push(m[1]!);
  }
  for (const m of src.matchAll(/^type\s+([A-Z]\w*)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|else|for|switch|case|select|go|defer|return)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// Rust: `use path::to::item;`, `mod name;`, `pub use ...`
// ---------------------------------------------------------------------------
function extractRust(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*(?:pub\s+)?use\s+([^;]+);/gm)) {
    // use crate::foo::bar; -> we want the first segment for resolution
    const path = m[1]!.trim();
    imports.push(path);
  }
  // mod declarations (local modules)
  for (const m of src.matchAll(/^\s*(?:pub\s+)?mod\s+(\w+)/gm)) {
    imports.push(m[1]!);
  }
  // pub fn / pub struct / pub enum / pub trait / pub const / pub type
  for (const m of src.matchAll(/^\s*pub\s+(?:fn|struct|enum|trait|const|type|static)\s+(\w+)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|else|for|while|match|loop|return)\b/g);
  complexity += countMatches(src, /&&|\|\||\?\s*[;)]/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// Java: `import com.foo.Bar;` and `package com.foo;`
// ---------------------------------------------------------------------------
function extractJava(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)/gm)) {
    imports.push(m[1]!);
  }
  for (const m of src.matchAll(/^\s*(?:public\s+)?(?:class|interface|enum|record)\s+(\w+)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|else|for|while|switch|case|catch|return|throw)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// C/C++: `#include "file.h"` and `#include <...>`
// ---------------------------------------------------------------------------
function extractC(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)) {
    imports.push(m[1]!);
  }
  // System includes <...> are skipped (external)

  complexity += countMatches(src, /\b(if|else|for|while|switch|case|return|do)\b/g);
  complexity += countMatches(src, /&&|\|\||\?\s/g);

  return { imports: dedupe(imports), exports, complexity };
}

// ---------------------------------------------------------------------------
// Ruby: `require 'x'`, `require_relative 'x'`, `load 'x'`
// ---------------------------------------------------------------------------
function extractRuby(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*(?:require|require_relative|load)\s+['"]([^'"]+)['"]/gm)) {
    imports.push(m[1]!);
  }
  // module/class at top level
  for (const m of src.matchAll(/^\s*(?:module|class)\s+(\w+)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|unless|else|elsif|for|while|until|case|when|return|rescue)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// PHP: `use Foo\Bar;`, `require 'x'`, `include 'x'`
// ---------------------------------------------------------------------------
function extractPhp(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*use\s+([\w\\]+)/gm)) {
    if (!m[1]!.startsWith('function') && !m[1]!.startsWith('const')) imports.push(m[1]!);
  }
  for (const m of src.matchAll(/^\s*(?:require|include)(?:_once)?\s+['"]([^'"]+)['"]/gm)) {
    imports.push(m[1]!);
  }
  for (const m of src.matchAll(/^\s*(?:class|interface|trait|function)\s+(\w+)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|else|elseif|for|foreach|while|switch|case|return|try|catch)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// C#: `using Namespace.Sub;`
// ---------------------------------------------------------------------------
function extractCSharp(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm)) {
    imports.push(m[1]!);
  }
  for (const m of src.matchAll(/^\s*(?:public|internal|private|protected)?\s*(?:partial\s+)?(?:class|interface|struct|enum|record)\s+(\w+)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|else|for|foreach|while|switch|case|return|try|catch)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// Swift: `import Foo`, `@_exported import Foo`
// ---------------------------------------------------------------------------
function extractSwift(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*@?\w*\s*import\s+(?:typealias\s+)?(\w+)/gm)) {
    imports.push(m[1]!);
  }
  for (const m of src.matchAll(/^\s*(?:public|open|internal)?\s*(?:class|struct|enum|protocol|func|extension)\s+(\w+)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|else|for|while|switch|case|return|guard)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// Kotlin: `import com.foo.Bar`
// ---------------------------------------------------------------------------
function extractKotlin(src: string): ExtractedDeps {
  const imports: string[] = [];
  const exports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*import\s+([\w.]+)/gm)) {
    imports.push(m[1]!);
  }
  for (const m of src.matchAll(/^\s*(?:class|object|interface|fun|val|var|enum)\s+(\w+)/gm)) {
    exports.push(m[1]!);
  }

  complexity += countMatches(src, /\b(if|else|for|while|when|return|try|catch)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);

  return { imports: dedupe(imports), exports: dedupe(exports), complexity };
}

// ---------------------------------------------------------------------------
// Shell: `source x` / `. x`
// ---------------------------------------------------------------------------
function extractShell(src: string): ExtractedDeps {
  const imports: string[] = [];
  let complexity = 1;

  for (const m of src.matchAll(/^\s*(?:source|\.)\s+(\S+)/gm)) {
    imports.push(m[1]!);
  }
  complexity += countMatches(src, /\b(if|then|else|elif|fi|for|while|until|case|esac|function)\b/g);

  return { imports: dedupe(imports), exports: [], complexity };
}

// ---------------------------------------------------------------------------
// Generic fallback: complexity only, no imports
// ---------------------------------------------------------------------------
function extractGeneric(src: string): ExtractedDeps {
  let complexity = 1;
  complexity += countMatches(src, /\b(if|else|for|while|switch|case|return|catch|try)\b/g);
  complexity += countMatches(src, /&&|\|\|/g);
  return { imports: [], exports: [], complexity };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
export function extractByLanguage(language: string, src: string): ExtractedDeps {
  switch (language) {
    case 'Python': return extractPython(src);
    case 'Go': return extractGo(src);
    case 'Rust': return extractRust(src);
    case 'Java': return extractJava(src);
    case 'C': case 'C++': return extractC(src);
    case 'Ruby': return extractRuby(src);
    case 'PHP': return extractPhp(src);
    case 'C#': return extractCSharp(src);
    case 'Swift': return extractSwift(src);
    case 'Kotlin': return extractKotlin(src);
    case 'Shell': case 'Bash': case 'Zsh': case 'Fish': case 'PowerShell': return extractShell(src);
    default: return extractGeneric(src);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function countMatches(src: string, re: RegExp): number {
  const m = src.match(re);
  return m ? m.length : 0;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
