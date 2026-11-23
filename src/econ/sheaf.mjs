// Cellular sheaves on a graph, and the cohomology that measures when local
// economic data fails to glue into a global picture.
//
// A cellular sheaf F on a graph assigns a vector space (a "stalk") to every
// vertex and every edge, plus a linear restriction map F(v) -> F(e) whenever v
// is an endpoint of e. Read economically: each district carries its own local
// price or activity vector, and each link carries the part of that vector the
// two districts can actually compare.
//
//   C^0 = (+) F(v)   local data, one reading per district
//   C^1 = (+) F(e)   pairwise disagreements, one per link
//   (d x)_e = r_{e,target} x_target - r_{e,source} x_source
//
//   H^0 = ker d      the globally consistent assignments (global sections)
//   H^1 = C^1 / im d the obstructions: disagreements no assignment can explain
//
// A nonzero class in H^1 is a circulation of local discrepancies that cannot
// be written off as a difference of district-level levels. When the stalks are
// log prices and the restriction maps are transport wedges, that is exactly an
// arbitrage loop. Cellular sheaves and their Laplacians in this form are due
// to Hansen & Ghrist.

import {
  leastSquares, matMul, matVec, norm, nullspace, rank, symmetricEigenvalues, transpose, zeros,
} from "./linalg.mjs";

/**
 * @param {{id: string, dim: number}[]} vertices
 * @param {{source: string, target: string, dim: number, source_map: number[][], target_map: number[][]}[]} edges
 */
export function createSheaf(vertices, edges) {
  const offsets = new Map();
  let vertexTotal = 0;
  for (const vertex of vertices) {
    offsets.set(vertex.id, vertexTotal);
    vertexTotal += vertex.dim;
  }
  let edgeTotal = 0;
  const edgeOffsets = edges.map((edge) => {
    const offset = edgeTotal;
    edgeTotal += edge.dim;
    return offset;
  });
  for (const edge of edges) {
    if (!offsets.has(edge.source) || !offsets.has(edge.target)) {
      throw new Error(`createSheaf: edge ${edge.source}->${edge.target} references an unknown vertex`);
    }
  }
  return { vertices, edges, offsets, edgeOffsets, vertexTotal, edgeTotal };
}

/** The coboundary d : C^0 -> C^1 as a dense matrix. */
export function coboundary(sheaf) {
  const matrix = zeros(sheaf.edgeTotal, sheaf.vertexTotal);
  sheaf.edges.forEach((edge, index) => {
    const row = sheaf.edgeOffsets[index];
    const sourceOffset = sheaf.offsets.get(edge.source);
    const targetOffset = sheaf.offsets.get(edge.target);
    for (let local = 0; local < edge.dim; local += 1) {
      edge.source_map[local].forEach((value, column) => {
        matrix[row + local][sourceOffset + column] -= value;
      });
      edge.target_map[local].forEach((value, column) => {
        matrix[row + local][targetOffset + column] += value;
      });
    }
  });
  return matrix;
}

/** The sheaf Laplacian L = d^T d, the quadratic form measuring total discord. */
export function sheafLaplacian(sheaf) {
  const d = coboundary(sheaf);
  return matMul(transpose(d), d);
}

/**
 * Global sections H^0 = ker d: the assignments of local data that every link
 * agrees with simultaneously. dim H^0 = 0 means the links pin the economy down
 * completely; a large dim H^0 means many mutually consistent price systems.
 */
export function globalSections(sheaf, tolerance = 1e-9) {
  return nullspace(coboundary(sheaf), tolerance);
}

export function cohomology(sheaf, tolerance = 1e-9) {
  const d = coboundary(sheaf);
  const r = rank(d, tolerance);
  return {
    h0: sheaf.vertexTotal - r,
    h1: sheaf.edgeTotal - r,
    dimC0: sheaf.vertexTotal,
    dimC1: sheaf.edgeTotal,
    rank: r,
  };
}

/**
 * Decompose an observed 1-cochain (the measured disagreement on each link)
 * into the part explained by district-level data and the part that is not.
 *
 * cochain = d(potential) + obstruction,  obstruction orthogonal to im d
 *
 * The obstruction is the harmonic representative of the class in H^1. Its norm
 * is a single number saying how far the local readings are from gluing, and it
 * is zero exactly when a globally consistent explanation exists.
 */
export function decompose(sheaf, cochain) {
  if (cochain.length !== sheaf.edgeTotal) {
    throw new Error(`decompose: expected a cochain of length ${sheaf.edgeTotal}`);
  }
  const d = coboundary(sheaf);
  const potential = leastSquares(d, cochain);
  const explained = matVec(d, potential);
  const obstruction = cochain.map((value, index) => value - explained[index]);
  const total = norm(cochain);
  return {
    potential,
    explained,
    obstruction,
    obstructionNorm: norm(obstruction),
    explainedNorm: norm(explained),
    // 0 = perfectly glueable, 1 = entirely obstruction.
    inconsistency: total > 1e-12 ? norm(obstruction) / total : 0,
    consistent: norm(obstruction) < 1e-8 * Math.max(1, total),
  };
}

/** Per-edge share of the obstruction, for ranking which links carry the defect. */
export function obstructionByEdge(sheaf, cochain) {
  const { obstruction } = decompose(sheaf, cochain);
  return sheaf.edges.map((edge, index) => {
    const offset = sheaf.edgeOffsets[index];
    const slice = obstruction.slice(offset, offset + edge.dim);
    return { source: edge.source, target: edge.target, magnitude: norm(slice), components: slice };
  }).sort((a, b) => b.magnitude - a.magnitude);
}

/**
 * Spectrum of the sheaf Laplacian. The multiplicity of the zero eigenvalue is
 * dim H^0; the smallest nonzero eigenvalue is the rate at which decentralised
 * local adjustment converges to a consistent price system, so it is the
 * sheaf-theoretic version of how well integrated the market is.
 */
export function spectrum(sheaf, tolerance = 1e-9) {
  const eigenvalues = symmetricEigenvalues(sheafLaplacian(sheaf));
  const zeroCount = eigenvalues.filter((value) => Math.abs(value) < tolerance).length;
  const positive = eigenvalues.filter((value) => value > tolerance);
  return {
    eigenvalues,
    kernelDimension: zeroCount,
    spectralGap: positive.length > 0 ? positive[0] : 0,
    largest: eigenvalues.length > 0 ? eigenvalues[eigenvalues.length - 1] : 0,
  };
}

/**
 * Sheaf heat flow x <- x - rate * L x. Districts revise their local readings
 * toward what their neighbours can agree with; the flow converges to the
 * nearest global section when one exists.
 */
export function diffuse(sheaf, initial, { steps = 200, rate = null } = {}) {
  const laplacian = sheafLaplacian(sheaf);
  const eigenvalues = symmetricEigenvalues(laplacian);
  const largest = eigenvalues.length > 0 ? eigenvalues[eigenvalues.length - 1] : 1;
  const stepSize = rate ?? (largest > 0 ? 1 / largest : 0.1);
  let current = [...initial];
  for (let step = 0; step < steps; step += 1) {
    const gradient = matVec(laplacian, current);
    current = current.map((value, index) => value - stepSize * gradient[index]);
  }
  const residual = norm(matVec(laplacian, current));
  return { state: current, residual, stepSize };
}

/** Read a vertex's slice out of a 0-cochain. */
export function vertexSlice(sheaf, cochain, id) {
  const vertex = sheaf.vertices.find((candidate) => candidate.id === id);
  if (!vertex) throw new Error(`vertexSlice: unknown vertex ${id}`);
  const offset = sheaf.offsets.get(id);
  return cochain.slice(offset, offset + vertex.dim);
}
