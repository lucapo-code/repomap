import { describe, it, expect } from 'vitest';
import { findCircularDependencies } from '../src/cli/cycles.js';

describe('findCircularDependencies (Tarjan SCC)', () => {
  it('grafo sin ciclos devuelve vacío', () => {
    const r = findCircularDependencies(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ]
    );
    expect(r.cycles).toEqual([]);
    expect(r.cyclicEdgeKeys.size).toBe(0);
    expect(r.cyclicNodeIds.size).toBe(0);
  });

  it('detecta un ciclo simple a -> b -> a', () => {
    const r = findCircularDependencies(
      ['a', 'b'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ]
    );
    expect(r.cycles.length).toBe(1);
    expect(r.cyclicNodeIds.has('a')).toBe(true);
    expect(r.cyclicNodeIds.has('b')).toBe(true);
    expect(r.cyclicEdgeKeys.has('a\0b')).toBe(true);
    expect(r.cyclicEdgeKeys.has('b\0a')).toBe(true);
  });

  it('detecta ciclo de 3 nodos y no marca aristas externas al ciclo', () => {
    const r = findCircularDependencies(
      ['a', 'b', 'c', 'd'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' }, // ciclo a-b-c-a
        { from: 'd', to: 'a' }, // d apunta al ciclo pero no está en él
      ]
    );
    expect(r.cycles.length).toBe(1);
    expect(r.cyclicNodeIds.has('a')).toBe(true);
    expect(r.cyclicNodeIds.has('b')).toBe(true);
    expect(r.cyclicNodeIds.has('c')).toBe(true);
    expect(r.cyclicNodeIds.has('d')).toBe(false);
    expect(r.cyclicEdgeKeys.has('d\0a')).toBe(false);
  });

  it('dos ciclos disjuntos se detectan ambos', () => {
    const r = findCircularDependencies(
      ['a', 'b', 'c', 'd'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'c', to: 'd' },
        { from: 'd', to: 'c' },
      ]
    );
    expect(r.cycles.length).toBe(2);
  });

  it('self-loop no produce SCC de tamaño 1 (se ignora como ciclo de 1 nodo)', () => {
    const r = findCircularDependencies(
      ['a'],
      [{ from: 'a', to: 'a' }]
    );
    expect(r.cycles).toEqual([]);
  });

  it('grafo vacío no rompe', () => {
    const r = findCircularDependencies([], []);
    expect(r.cycles).toEqual([]);
    expect(r.cyclicNodeIds.size).toBe(0);
  });

  it('nodos aislados no crean ciclos', () => {
    const r = findCircularDependencies(['a', 'b', 'c'], []);
    expect(r.cycles).toEqual([]);
    expect(r.cyclicEdgeKeys.size).toBe(0);
  });
});
