/**
 * Example call patterns used to validate graph/cycle visualization.
 */

// 1) Direct recursion: function calls itself.
export function factorialRecursive(n: number): number {
  if (n <= 1) {
    return 1;
  }
  return n * factorialRecursive(n - 1);
}

// 2) Two-function mutual recursion.
export function isEvenMutual(n: number): boolean {
  if (n === 0) {
    return true;
  }
  return isOddMutual(Math.abs(n) - 1);
}

export function isOddMutual(n: number): boolean {
  if (n === 0) {
    return false;
  }
  return isEvenMutual(Math.abs(n) - 1);
}

// 3) Four-function loop/chain cycle.
export function cycleA(value: number): number {
  return cycleB(value + 1);
}

export function cycleB(value: number): number {
  return cycleC(value * 2);
}

export function cycleC(value: number): number {
  return cycleD(value - 3);
}

export function cycleD(value: number): number {
  // Close the loop back to A once, then stop for deterministic output.
  if (value <= 10) {
    return cycleA(value + 4);
  }
  return value;
}

// Optional simple runner for quick manual checks.
export function runCallCycleExamples(seed: number): {
  recursive: number;
  mutual: { even: boolean; odd: boolean };
  cycle: number;
} {
  return {
    recursive: factorialRecursive(Math.max(0, seed % 8)),
    mutual: {
      even: isEvenMutual(seed),
      odd: isOddMutual(seed),
    },
    cycle: cycleA(seed),
  };
}
