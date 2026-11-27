import { describe, it, expect } from 'vitest';
import { extractByLanguage } from '../src/cli/extractors.js';

describe('extractByLanguage', () => {
  describe('Python', () => {
    const src = [
      'import os',
      'import sys, json as js',
      'from collections import OrderedDict',
      'from . import sibling',
      'from ..pkg import thing',
      '# import commented',
      'def top_level():',
      '    pass',
      'class Foo:',
      '    pass',
      '',
      'x = 1 if True else 2',
      'for i in range(3):',
      '    if i and x:',
      '        pass',
    ].join('\n');

    it('extrae imports simples, múltiples y from-import', () => {
      const r = extractByLanguage('Python', src);
      expect(r.imports).toContain('os');
      expect(r.imports).toContain('sys');
      expect(r.imports).toContain('json');
      expect(r.imports).toContain('collections');
      expect(r.imports).toContain('.');
      expect(r.imports).toContain('..pkg');
      expect(r.imports).not.toContain('commented');
    });

    it('extrae def/class top-level como exports', () => {
      const r = extractByLanguage('Python', src);
      expect(r.exports).toContain('top_level');
      expect(r.exports).toContain('Foo');
    });

    it('calcula complexity > 1 con control de flujo', () => {
      const r = extractByLanguage('Python', src);
      expect(r.complexity).toBeGreaterThan(3);
    });
  });

  describe('Go', () => {
    const src = [
      'package main',
      '',
      'import "fmt"',
      'import (',
      '\t"os"',
      '\t"github.com/user/repo/pkg"',
      ')',
      '',
      'func Exported() int {',
      '\tif true { return 1 } else { return 0 }',
      '}',
      'func unexported() {}',
      'type Config struct{}',
    ].join('\n');

    it('extrae imports single y en bloque', () => {
      const r = extractByLanguage('Go', src);
      expect(r.imports).toContain('fmt');
      expect(r.imports).toContain('os');
      expect(r.imports).toContain('github.com/user/repo/pkg');
    });

    it('extrae solo funciones/types exportados (mayúscula)', () => {
      const r = extractByLanguage('Go', src);
      expect(r.exports).toContain('Exported');
      expect(r.exports).toContain('Config');
      expect(r.exports).not.toContain('unexported');
    });
  });

  describe('Rust', () => {
    const src = [
      'use std::collections::HashMap;',
      'use crate::utils::helper;',
      'pub use self::thing::Thing;',
      'mod inner;',
      '',
      'pub fn do_it() -> bool {',
      '\tif true { return true; }',
      '}',
      'pub struct Config { x: i32 }',
      'fn private_fn() {}',
    ].join('\n');

    it('extrae use y mod como imports', () => {
      const r = extractByLanguage('Rust', src);
      expect(r.imports.some(i => i.includes('std::collections::HashMap'))).toBe(true);
      expect(r.imports.some(i => i.includes('crate::utils::helper'))).toBe(true);
      expect(r.imports).toContain('inner');
    });

    it('extrae pub fn/struct como exports, no los privados', () => {
      const r = extractByLanguage('Rust', src);
      expect(r.exports).toContain('do_it');
      expect(r.exports).toContain('Config');
      expect(r.exports).not.toContain('private_fn');
    });
  });

  describe('Java', () => {
    const src = [
      'package com.example;',
      'import java.util.List;',
      'import static java.util.Objects.requireNonNull;',
      '',
      'public class Main {',
      '\tpublic static void main(String[] args) {',
      '\t\tif (args.length > 0) { System.out.println(args[0]); }',
      '\t}',
      '}',
    ].join('\n');

    it('extrae imports y la clase como export', () => {
      const r = extractByLanguage('Java', src);
      expect(r.imports).toContain('java.util.List');
      expect(r.imports).toContain('java.util.Objects.requireNonNull');
      expect(r.exports).toContain('Main');
      expect(r.complexity).toBeGreaterThan(1);
    });
  });

  describe('C/C++', () => {
    const src = [
      '#include "utils.h"',
      '#include <stdio.h>',
      '',
      'int main() {',
      '\tif (1) return 0;',
      '\treturn 1;',
      '}',
    ].join('\n');

    it('extrae solo includes con comillas (locales), no <system>', () => {
      const r = extractByLanguage('C', src);
      expect(r.imports).toContain('utils.h');
      expect(r.imports).not.toContain('stdio.h');
      expect(r.complexity).toBeGreaterThan(1);
    });
  });

  describe('Ruby', () => {
    const src = [
      "require 'json'",
      "require_relative 'helper'",
      '',
      'module MyMod',
      '  def self.run',
      '    if true',
      '    end',
      '  end',
      'end',
    ].join('\n');

    it('extrae require/require_relative y module', () => {
      const r = extractByLanguage('Ruby', src);
      expect(r.imports).toContain('json');
      expect(r.imports).toContain('helper');
      expect(r.exports).toContain('MyMod');
    });
  });

  describe('lenguaje desconocido (fallback genérico)', () => {
    it('no rompe y devuelve complexity sin imports', () => {
      const r = extractByLanguage('Brainfuck', '+++[>++<-] if else for');
      expect(r.imports).toEqual([]);
      expect(r.complexity).toBeGreaterThan(1);
    });
  });

  it('deduplica imports repetidos', () => {
    const r = extractByLanguage('Python', 'import os\nimport os\nfrom os import path\n');
    expect(r.imports.filter(i => i === 'os').length).toBe(1);
  });
});
