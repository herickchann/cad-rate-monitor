'use strict';
(() => {
  const widgets = [];
  function sync(widget) {
    const value = widget.input.valueAsNumber;
    widget.less.disabled = Number.isFinite(value) && value <= Number(widget.input.min);
    widget.more.disabled = Number.isFinite(value) && value >= Number(widget.input.max);
  }
  for (const input of document.querySelectorAll('.settings-grid input[type="number"]')) {
    const wrapper = document.createElement('div'); wrapper.className = 'number-stepper';
    input.before(wrapper);
    const label = document.querySelector(`label[for="${input.id}"]`).textContent;
    const less = document.createElement('button'), more = document.createElement('button');
    for (const [button, text, action] of [[less, '−', 'Decrease'], [more, '+', 'Increase']]) {
      button.type = 'button'; button.className = 'stepper-button'; button.textContent = text;
      button.setAttribute('aria-label', `${action} ${label}`); button.setAttribute('aria-controls', input.id);
    }
    wrapper.append(less, input, more);
    input.inputMode = input.step === 'any' ? 'decimal' : Number(input.step) < 1 ? 'decimal' : 'numeric';
    const widget = {input, less, more}; widgets.push(widget);
    function change(direction) {
      const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : Number(input.min) || 0;
      const increment = input.step === 'any' ? 100 : Number(input.step) || 1;
      const minimum = input.min === '' ? -Infinity : Number(input.min);
      const maximum = input.max === '' ? Infinity : Number(input.max);
      input.value = String(Math.min(maximum, Math.max(minimum, Number((value + direction * increment).toFixed(8)))));
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
      sync(widget);
    }
    less.addEventListener('click', () => change(-1)); more.addEventListener('click', () => change(1));
    input.addEventListener('input', () => sync(widget)); input.addEventListener('change', () => sync(widget));
    sync(widget);
  }
  window.refreshCustomSteppers = () => widgets.forEach(sync);
})();
