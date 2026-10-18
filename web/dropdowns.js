'use strict';
// Keep the original controls as the source of values and change events.
(() => {
  const widgets = [];
  let opened;
  function close() {
    if (!opened) return;
    opened.menu.hidden = true;
    opened.button.setAttribute('aria-expanded', 'false');
    opened.button.removeAttribute('aria-activedescendant');
    opened = null;
  }
  function highlight(widget, index) {
    widget.active = index;
    widget.items.forEach((item, i) => item.classList.toggle('is-active', i === index));
    widget.button.setAttribute('aria-activedescendant', widget.items[index].id);
    const item = widget.items[index], top = item.offsetTop, bottom = top + item.offsetHeight;
    if (top < widget.menu.scrollTop) widget.menu.scrollTop = top;
    else if (bottom > widget.menu.scrollTop + widget.menu.clientHeight) widget.menu.scrollTop = bottom - widget.menu.clientHeight;
  }
  function sync(widget) {
    const selected = widget.select.selectedIndex;
    widget.value.textContent = widget.select.options[selected]?.textContent || '';
    widget.items.forEach((item, i) => item.setAttribute('aria-selected', String(i === selected)));
  }
  function open(widget, index = widget.select.selectedIndex) {
    close(); sync(widget); opened = widget;
    const bounds = widget.button.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 12, above = bounds.top - 12;
    const upwards = below < Math.min(280, widget.items.length * 40 + 12) && above > below;
    const width = Math.min(Math.max(bounds.width, 180), window.innerWidth - 24);
    Object.assign(widget.menu.style, {width:width + 'px', left:Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)) + 'px', maxHeight:Math.max(40, Math.min(300, upwards ? above : below)) + 'px', top:upwards ? 'auto' : bounds.bottom + 6 + 'px', bottom:upwards ? window.innerHeight - bounds.top + 6 + 'px' : 'auto'});
    widget.menu.hidden = false;
    widget.button.setAttribute('aria-expanded', 'true');
    highlight(widget, Math.max(0, index));
  }
  function choose(widget, index) {
    widget.select.selectedIndex = index;
    widget.select.dispatchEvent(new Event('change', {bubbles:true}));
    sync(widget); close(); widget.button.focus({preventScroll:true});
  }
  for (const select of document.querySelectorAll('.history-filter select, .page-size-control select, .settings-grid select')) {
    const wrapper = document.createElement('div'); wrapper.className = 'site-select';
    select.before(wrapper); wrapper.appendChild(select);
    const label = document.querySelector(`label[for="${select.id}"]`);
    label.id ||= select.id + '-label';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'site-select-trigger'; button.id = select.id + '-trigger';
    button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span'); value.id = select.id + '-value';
    button.setAttribute('aria-labelledby', label.id + ' ' + value.id);
    const arrow = document.createElement('span'); arrow.className = 'site-select-arrow'; arrow.setAttribute('aria-hidden','true');
    button.append(value, arrow); wrapper.appendChild(button);
    const menu = document.createElement('div'); menu.id = select.id + '-options'; menu.className = 'site-select-menu'; menu.hidden = true;
    menu.setAttribute('role','listbox'); menu.setAttribute('aria-labelledby', label.id);
    button.setAttribute('aria-controls', menu.id);
    const items = [...select.options].map((option, index) => {
      const item = document.createElement('div'); item.className = 'site-select-option'; item.id = select.id + '-option-' + index;
      item.setAttribute('role','option'); item.textContent = option.textContent;
      item.addEventListener('click', () => choose(widget, index));
      menu.appendChild(item); return item;
    });
    const dialog = select.closest('dialog');
    (dialog || document.body).appendChild(menu);
    if (dialog) {
      dialog.addEventListener('close', () => { if (opened?.menu === menu) close(); });
      dialog.addEventListener('cancel', event => { if (opened?.menu === menu) { event.preventDefault(); close(); } });
    }
    const widget = {select, button, value, menu, items, active:0}; widgets.push(widget);
    select.hidden = true;
    label.addEventListener('click', event => {event.preventDefault(); button.focus();});
    button.addEventListener('click', () => opened === widget ? close() : open(widget));
    button.addEventListener('blur', close);
    // Options retain focus on the combobox for keyboard and screen-reader navigation.
    menu.addEventListener('mousedown', event => event.preventDefault());
    let search = '', searchTime = 0;
    button.addEventListener('keydown', event => {
      const isOpen = opened === widget;
      if (['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Escape') { close(); return; }
        if (event.key === 'Enter' || event.key === ' ') { if (isOpen) choose(widget, widget.active); else open(widget); return; }
        if (event.key === 'Home' || event.key === 'End') {
          const index = event.key === 'Home' ? 0 : items.length - 1;
          if (!isOpen) open(widget, index); else highlight(widget, index);
          return;
        }
        if (!isOpen) open(widget);
        else highlight(widget, Math.max(0, Math.min(items.length - 1, widget.active + (event.key === 'ArrowDown' ? 1 : -1))));
      } else if (event.key === 'Tab') close();
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now(); search = now - searchTime > 700 ? event.key : search + event.key; searchTime = now;
        const index = items.findIndex(item => item.textContent.toLowerCase().startsWith(search.toLowerCase()));
        if (index >= 0) { if (!isOpen) open(widget, index); else highlight(widget, index); }
      }
    });
    select.addEventListener('change', () => sync(widget)); sync(widget);
  }
  document.addEventListener('pointerdown', event => { if (opened && !opened.menu.contains(event.target) && !opened.button.contains(event.target)) close(); });
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  document.addEventListener('scroll', event => { if (opened && !opened.menu.contains(event.target)) close(); }, true);
  window.refreshCustomDropdowns = () => {close(); widgets.forEach(sync);};
})();
