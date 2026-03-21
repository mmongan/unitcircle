export function setupCounter(element: HTMLButtonElement) {
  let counter = 0;
  element.addEventListener('click', () => {
    counter = incrementCounterValue(counter);
    updateCounterDisplay(element, counter);
  });
  initializeCounter(element);
}

function updateCounterDisplay(element: HTMLButtonElement, count: number): void {
  formatCounterText(element, count);
}

function formatCounterText(element: HTMLButtonElement, count: number): void {
  element.innerHTML = `count is ${count}`;
}

function initializeCounter(element: HTMLButtonElement): void {
  updateCounterDisplay(element, 0);
}

function incrementCounterValue(current: number): number {
  return current + 1;
}
