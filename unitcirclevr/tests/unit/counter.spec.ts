import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupCounter } from '../../src/counter';

describe('counter', () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    // Create a fresh button element for each test
    button = document.createElement('button');
    document.body.appendChild(button);
  });

  afterEach(() => {
    // Clean up
    if (button && button.parentNode) {
      button.parentNode.removeChild(button);
    }
  });

  describe('setupCounter', () => {
    it('should initialize counter display to 0', () => {
      setupCounter(button);

      expect(button.innerHTML).toBe('count is 0');
    });

    it('should increment counter on button click', () => {
      setupCounter(button);

      button.click();
      expect(button.innerHTML).toBe('count is 1');
    });

    it('should increment counter multiple times', () => {
      setupCounter(button);

      button.click();
      expect(button.innerHTML).toBe('count is 1');

      button.click();
      expect(button.innerHTML).toBe('count is 2');

      button.click();
      expect(button.innerHTML).toBe('count is 3');
    });

    it('should handle rapid consecutive clicks', () => {
      setupCounter(button);

      for (let i = 0; i < 10; i++) {
        button.click();
      }

      expect(button.innerHTML).toBe('count is 10');
    });

    it('should not affect other elements', () => {
      const button1 = button;
      const button2 = document.createElement('button');
      document.body.appendChild(button2);

      setupCounter(button1);
      setupCounter(button2);

      button1.click();
      expect(button1.innerHTML).toBe('count is 1');
      expect(button2.innerHTML).toBe('count is 0');

      button2.click();
      button2.click();
      expect(button1.innerHTML).toBe('count is 1');
      expect(button2.innerHTML).toBe('count is 2');

      button2.parentNode?.removeChild(button2);
    });

    it('should work with same button after multiple setups', () => {
      setupCounter(button);
      button.click();
      expect(button.innerHTML).toBe('count is 1');

      // Reset button
      button.innerHTML = '';
      button.onclick = null;

      setupCounter(button);
      expect(button.innerHTML).toBe('count is 0');
    });

    it('should update text content, not attributes', () => {
      setupCounter(button);

      expect(button.innerHTML).toContain('count is 0');

      button.click();
      expect(button.innerHTML).toContain('count is 1');
      expect(button.getAttribute('data-count')).toBeNull();
    });

    it('should use correct formatting for counter text', () => {
      setupCounter(button);

      for (let i = 0; i <= 5; i++) {
        expect(button.innerHTML).toBe(`count is ${i}`);
        button.click();
      }
    });

    it('should handle large counter values', () => {
      setupCounter(button);

      for (let i = 0; i < 1000; i++) {
        button.click();
      }

      expect(button.innerHTML).toBe('count is 1000');
    });

    it('should preserve counter state across multiple clicks', () => {
      setupCounter(button);

      const clicks = [1, 5, 3, 2, 4];
      let expectedCount = 0;

      for (const clickCount of clicks) {
        for (let i = 0; i < clickCount; i++) {
          button.click();
          expectedCount++;
        }
        expect(button.innerHTML).toBe(`count is ${expectedCount}`);
      }
    });

    it('should work with different button types', () => {
      const buttonElement = document.createElement('button');
      buttonElement.type = 'submit';
      document.body.appendChild(buttonElement);

      setupCounter(buttonElement);
      expect(buttonElement.innerHTML).toBe('count is 0');

      buttonElement.click();
      expect(buttonElement.innerHTML).toBe('count is 1');

      buttonElement.parentNode?.removeChild(buttonElement);
    });

    it('should work with button created dynamically', () => {
      const dynamicButton = document.createElement('button');
      dynamicButton.id = 'dynamic-counter';
      document.body.appendChild(dynamicButton);

      setupCounter(dynamicButton);

      expect(dynamicButton.innerHTML).toBe('count is 0');
      dynamicButton.click();
      expect(dynamicButton.innerHTML).toBe('count is 1');

      dynamicButton.parentNode?.removeChild(dynamicButton);
    });

    it('should not rely on global state between instances', () => {
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      document.body.appendChild(button1);
      document.body.appendChild(button2);

      setupCounter(button1);
      setupCounter(button2);

      // Click button1 multiple times
      for (let i = 0; i < 5; i++) {
        button1.click();
      }

      // Button2 should still be at 0
      expect(button2.innerHTML).toBe('count is 0');

      // Then click button2
      button2.click();
      expect(button2.innerHTML).toBe('count is 1');
      expect(button1.innerHTML).toBe('count is 5');

      button1.parentNode?.removeChild(button1);
      button2.parentNode?.removeChild(button2);
    });

    it('should handle repeated initialization of same button', () => {
      setupCounter(button);
      expect(button.innerHTML).toBe('count is 0');

      button.click();
      expect(button.innerHTML).toBe('count is 1');

      // Initialize again - should reset
      setupCounter(button);
      expect(button.innerHTML).toBe('count is 0');

      button.click();
      expect(button.innerHTML).toBe('count is 1');
    });

    it('should work with event delegation', () => {
      const container = document.createElement('div');
      const counterButton = document.createElement('button');
      container.appendChild(counterButton);
      document.body.appendChild(container);

      setupCounter(counterButton);

      counterButton.click();
      expect(counterButton.innerHTML).toBe('count is 1');

      container.parentNode?.removeChild(container);
    });

    it('should properly format single digit numbers', () => {
      setupCounter(button);

      for (let i = 0; i < 9; i++) {
        expect(button.innerHTML).toMatch(/count is \d/);
        button.click();
      }
    });

    it('should properly format multi-digit numbers', () => {
      setupCounter(button);

      for (let i = 0; i < 100; i++) {
        button.click();
      }

      expect(button.innerHTML).toBe('count is 100');
      expect(button.innerHTML).toMatch(/count is \d+/);
    });

    it('should handle click events dispatched normally', () => {
      setupCounter(button);

      button.click();
      expect(button.innerHTML).toBe('count is 1');
    });

    it('should handle multiple click events in rapid succession', () => {
      setupCounter(button);

      const promises = [];
      for (let i = 0; i < 50; i++) {
        button.click();
      }

      expect(button.innerHTML).toBe('count is 50');
    });

    it('should format output with correct spacing', () => {
      setupCounter(button);

      button.click();
      const text = button.innerHTML;

      expect(text).toBe('count is 1');
      expect(text).toMatch(/^count\sis\s\d+$/);
    });
  });

  describe('Counter state isolation', () => {
    it('each button instance maintains independent state', () => {
      const buttonA = document.createElement('button');
      const buttonB = document.createElement('button');
      document.body.appendChild(buttonA);
      document.body.appendChild(buttonB);

      setupCounter(buttonA);
      setupCounter(buttonB);

      // Increment A
      for (let i = 0; i < 3; i++) buttonA.click();
      // Increment B differently
      for (let i = 0; i < 7; i++) buttonB.click();

      expect(buttonA.innerHTML).toBe('count is 3');
      expect(buttonB.innerHTML).toBe('count is 7');

      buttonA.parentNode?.removeChild(buttonA);
      buttonB.parentNode?.removeChild(buttonB);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero shows correctly', () => {
      setupCounter(button);
      expect(button.innerHTML).toBe('count is 0');
    });

    it('should work after clearing innerHTML', () => {
      setupCounter(button);
      button.click();
      expect(button.innerHTML).toBe('count is 1');

      // Clear and setup again
      button.innerHTML = '';
      setupCounter(button);
      expect(button.innerHTML).toBe('count is 0');
    });

    it('should preserve formatting with special characters in button content', () => {
      button.setAttribute('data-test', 'value');
      setupCounter(button);

      expect(button.innerHTML).toBe('count is 0');
      button.click();
      expect(button.innerHTML).toBe('count is 1');
    });
  });
});
