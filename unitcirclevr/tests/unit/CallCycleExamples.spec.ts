import { describe, it, expect } from 'vitest';
import {
  factorialRecursive,
  isEvenMutual,
  isOddMutual,
  cycleA,
  cycleB,
  cycleC,
  cycleD,
  runCallCycleExamples,
} from '../../src/CallCycleExamples';

describe('CallCycleExamples', () => {
  describe('factorialRecursive', () => {
    it('returns 1 for n = 0', () => {
      expect(factorialRecursive(0)).toBe(1);
    });

    it('returns 1 for n = 1', () => {
      expect(factorialRecursive(1)).toBe(1);
    });

    it('returns 1 for negative n', () => {
      expect(factorialRecursive(-5)).toBe(1);
    });

    it('computes 3! = 6', () => {
      expect(factorialRecursive(3)).toBe(6);
    });

    it('computes 5! = 120', () => {
      expect(factorialRecursive(5)).toBe(120);
    });

    it('computes 7! = 5040', () => {
      expect(factorialRecursive(7)).toBe(5040);
    });
  });

  describe('isEvenMutual', () => {
    it('returns true for 0', () => {
      expect(isEvenMutual(0)).toBe(true);
    });

    it('returns true for even positive numbers', () => {
      expect(isEvenMutual(2)).toBe(true);
      expect(isEvenMutual(4)).toBe(true);
      expect(isEvenMutual(10)).toBe(true);
    });

    it('returns false for odd positive numbers', () => {
      expect(isEvenMutual(1)).toBe(false);
      expect(isEvenMutual(3)).toBe(false);
      expect(isEvenMutual(7)).toBe(false);
    });

    it('handles negative values via abs()', () => {
      expect(isEvenMutual(-2)).toBe(true);
      expect(isEvenMutual(-3)).toBe(false);
    });
  });

  describe('isOddMutual', () => {
    it('returns false for 0', () => {
      expect(isOddMutual(0)).toBe(false);
    });

    it('returns true for odd positive numbers', () => {
      expect(isOddMutual(1)).toBe(true);
      expect(isOddMutual(3)).toBe(true);
      expect(isOddMutual(9)).toBe(true);
    });

    it('returns false for even positive numbers', () => {
      expect(isOddMutual(2)).toBe(false);
      expect(isOddMutual(4)).toBe(false);
    });

    it('handles negative values via abs()', () => {
      expect(isOddMutual(-1)).toBe(true);
      expect(isOddMutual(-4)).toBe(false);
    });

    it('isEvenMutual and isOddMutual are complements', () => {
      for (const n of [0, 1, 2, 3, 4, 5]) {
        expect(isEvenMutual(n) !== isOddMutual(n)).toBe(true);
      }
    });
  });

  describe('cycleD (termination guard)', () => {
    it('returns value unchanged when value > 10', () => {
      expect(cycleD(11)).toBe(11);
      expect(cycleD(100)).toBe(100);
      expect(cycleD(50)).toBe(50);
    });
  });

  describe('cycleC', () => {
    it('subtracts 3 and delegates — cycleC(14) terminates via cycleD(11) = 11', () => {
      expect(cycleC(14)).toBe(11);
    });
  });

  describe('cycleB', () => {
    it('doubles value, chains through cycleC → cycleD — cycleB(7) = cycleC(14) = 11', () => {
      expect(cycleB(7)).toBe(11);
    });
  });

  describe('cycleA', () => {
    it('returns a finite number', () => {
      const result = cycleA(0);
      expect(Number.isFinite(result)).toBe(true);
    });

    it('result is deterministic for the same input', () => {
      expect(cycleA(3)).toBe(cycleA(3));
    });
  });

  describe('runCallCycleExamples', () => {
    it('returns an object with recursive, mutual, and cycle properties', () => {
      const result = runCallCycleExamples(5);
      expect(result).toHaveProperty('recursive');
      expect(result).toHaveProperty('mutual');
      expect(result).toHaveProperty('cycle');
    });

    it('recursive equals factorial of (seed % 8)', () => {
      const result = runCallCycleExamples(5);
      expect(result.recursive).toBe(factorialRecursive(5 % 8));
    });

    it('mutual.even reflects seed parity', () => {
      expect(runCallCycleExamples(4).mutual.even).toBe(true);
      expect(runCallCycleExamples(3).mutual.even).toBe(false);
    });

    it('mutual.odd is complement of mutual.even', () => {
      const evenSeed = runCallCycleExamples(4);
      const oddSeed = runCallCycleExamples(3);
      expect(evenSeed.mutual.even).toBe(!evenSeed.mutual.odd);
      expect(oddSeed.mutual.even).toBe(!oddSeed.mutual.odd);
    });

    it('cycle result is a finite number', () => {
      const result = runCallCycleExamples(3);
      expect(Number.isFinite(result.cycle)).toBe(true);
    });
  });
});
