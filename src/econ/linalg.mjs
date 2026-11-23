// Small dense real linear algebra, enough to do homological bookkeeping on
// cellular sheaves: ranks, kernels, least squares and symmetric spectra.

export function zeros(rows, columns) {
  return Array.from({ length: rows }, () => new Array(columns).fill(0));
}

export function transpose(matrix) {
  if (matrix.length === 0) return [];
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

export function matMul(a, b) {
  if (a.length === 0 || b.length === 0) return [];
  const inner = b.length;
  const columns = b[0].length;
  return a.map((row) =>
    Array.from({ length: columns }, (_, column) => {
      let sum = 0;
      for (let index = 0; index < inner; index += 1) sum += row[index] * b[index][column];
      return sum;
    }),
  );
}

export function matVec(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

export function norm(vector) {
  return Math.hypot(...vector);
}

/** Reduced row echelon form, returning the pivot columns alongside. */
export function rref(matrix, tolerance = 1e-9) {
  const result = matrix.map((row) => [...row]);
  const rows = result.length;
  const columns = rows === 0 ? 0 : result[0].length;
  const pivots = [];
  let pivotRow = 0;
  for (let column = 0; column < columns && pivotRow < rows; column += 1) {
    let best = pivotRow;
    for (let row = pivotRow + 1; row < rows; row += 1) {
      if (Math.abs(result[row][column]) > Math.abs(result[best][column])) best = row;
    }
    if (Math.abs(result[best][column]) < tolerance) continue;
    [result[pivotRow], result[best]] = [result[best], result[pivotRow]];
    const scale = result[pivotRow][column];
    for (let index = 0; index < columns; index += 1) result[pivotRow][index] /= scale;
    for (let row = 0; row < rows; row += 1) {
      if (row === pivotRow) continue;
      const factor = result[row][column];
      if (Math.abs(factor) < 1e-15) continue;
      for (let index = 0; index < columns; index += 1) result[row][index] -= factor * result[pivotRow][index];
    }
    pivots.push(column);
    pivotRow += 1;
  }
  return { matrix: result, pivots };
}

export function rank(matrix, tolerance = 1e-9) {
  if (matrix.length === 0) return 0;
  return rref(matrix, tolerance).pivots.length;
}

/** Basis of { x : Mx = 0 }, one column vector per free variable. */
export function nullspace(matrix, tolerance = 1e-9) {
  if (matrix.length === 0) return [];
  const columns = matrix[0].length;
  const { matrix: reduced, pivots } = rref(matrix, tolerance);
  const free = [];
  for (let column = 0; column < columns; column += 1) {
    if (!pivots.includes(column)) free.push(column);
  }
  return free.map((freeColumn) => {
    const vector = new Array(columns).fill(0);
    vector[freeColumn] = 1;
    pivots.forEach((pivotColumn, pivotIndex) => {
      vector[pivotColumn] = -reduced[pivotIndex][freeColumn];
    });
    const length = norm(vector);
    return length > 0 ? vector.map((value) => value / length) : vector;
  });
}

/**
 * Minimum-norm least squares solution of Ax = b, via the normal equations with
 * a small ridge term so that rank-deficient systems still return the component
 * that is actually determined.
 */
export function leastSquares(matrix, target, ridge = 1e-10) {
  if (matrix.length === 0) return [];
  const columns = matrix[0].length;
  const at = transpose(matrix);
  const normal = matMul(at, matrix).map((row, index) =>
    row.map((value, column) => (index === column ? value + ridge : value)),
  );
  const rhs = matVec(at, target);
  const augmented = normal.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < columns; column += 1) {
    let best = column;
    for (let row = column + 1; row < columns; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[best][column])) best = row;
    }
    if (Math.abs(augmented[best][column]) < 1e-14) continue;
    [augmented[column], augmented[best]] = [augmented[best], augmented[column]];
    for (let row = 0; row < columns; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column] / augmented[column][column];
      for (let index = column; index <= columns; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return Array.from({ length: columns }, (_, index) =>
    Math.abs(augmented[index][index]) < 1e-14 ? 0 : augmented[index][columns] / augmented[index][index],
  );
}

/** Eigenvalues of a symmetric matrix by the cyclic Jacobi method, ascending. */
export function symmetricEigenvalues(matrix, sweeps = 60, tolerance = 1e-12) {
  const size = matrix.length;
  if (size === 0) return [];
  const a = matrix.map((row) => [...row]);
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    let off = 0;
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) off += a[row][column] ** 2;
    }
    if (off < tolerance) break;
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let index = 0; index < size; index += 1) {
          const aip = a[index][p];
          const aiq = a[index][q];
          a[index][p] = c * aip - s * aiq;
          a[index][q] = s * aip + c * aiq;
        }
        for (let index = 0; index < size; index += 1) {
          const api = a[p][index];
          const aqi = a[q][index];
          a[p][index] = c * api - s * aqi;
          a[q][index] = s * api + c * aqi;
        }
      }
    }
  }
  return Array.from({ length: size }, (_, index) => a[index][index]).sort((x, y) => x - y);
}
