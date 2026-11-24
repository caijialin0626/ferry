import { t } from './i18n.js';
export function enhanceSelects(icon) {
  const list = document.createElement('div');
  list.id = 'select-menu';
  list.className = 'select-menu';
  list.setAttribute('role', 'listbox');
  const hasPopover = typeof list.showPopover === 'function';
  if (hasPopover) list.popover = 'manual';
  let current;
  let activeIndex = -1;
  let search = '';
  let searchAt = 0;
  let renderedOptions;

  function chooseActive(index, scroll = true) {
    activeIndex = index;
    for (const row of list.children) row.toggleAttribute('data-active', Number(row.dataset.index) === index);
    const option = list.children[index];
    if (option) {
      current.button.setAttribute('aria-activedescendant', option.id);
      if (scroll) option.scrollIntoView({ block: 'nearest' });
    } else current.button.removeAttribute('aria-activedescendant');
  }
  function enabledOptions() {
    return [...current.select.options].flatMap((option, index) => option.disabled || option.hidden ? [] : [index]);
  }
  function closeMenu() {
    if (!current) return;
    current.button.setAttribute('aria-expanded', 'false');
    current.button.removeAttribute('aria-activedescendant');
    current.button.removeAttribute('aria-controls');
    if (hasPopover) list.hidePopover();
    list.remove();
    current = undefined;
    renderedOptions = undefined;
    search = '';
  }
  function positionMenu() {
    if (!current) return;
    const { button } = current;
    if (!button.getClientRects().length || button.closest('dialog:not([open]), [inert]')) {
      closeMenu();
      return;
    }
    const anchor = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const inset = 8;
    const gap = 6;
    const left = (viewport?.offsetLeft ?? 0) + inset;
    const top = (viewport?.offsetTop ?? 0) + inset;
    const right = left + (viewport?.width ?? innerWidth) - inset * 2;
    const bottom = top + (viewport?.height ?? innerHeight) - inset * 2;
    if (anchor.bottom <= top || anchor.top >= bottom || anchor.right <= left || anchor.left >= right) {
      closeMenu();
      return;
    }
    const width = Math.min(right - left, Math.max(anchor.width, 212));
    list.style.width = width + 'px';
    list.style.left = Math.min(Math.max(left, anchor.left), right - width) + 'px';
    const above = anchor.top - top - gap;
    const below = bottom - anchor.bottom - gap;
    const ideal = Math.min(list.scrollHeight + 2, 336);
    const opensAbove = below < ideal && above > below;
    const height = Math.max(0, Math.min(opensAbove ? above : below, ideal));
    list.style.maxHeight = height + 'px';
    list.style.top = (opensAbove ? anchor.top - gap - height : anchor.bottom + gap) + 'px';
  }
  function drawOptions(index) {
    const { select } = current;
    const options = [...select.options];
    const signature = JSON.stringify([select.selectedIndex, options.map(option => [option.label, option.disabled, option.hidden])]);
    if (signature === renderedOptions) return;
    renderedOptions = signature;
    list.replaceChildren(...options.map((option, i) => {
      const row = document.createElement('div');
      row.id = 'select-option-' + i;
      row.dataset.index = String(i);
      row.className = 'select-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === select.selectedIndex));
      row.setAttribute('aria-disabled', String(option.disabled));
      row.hidden = option.hidden;
      const name = document.createElement('span');
      name.textContent = option.label;
      row.append(name, icon('check'));
      return row;
    }));
    positionMenu();
    if (!current) return;
    const enabled = enabledOptions();
    chooseActive(enabled.includes(index) ? index : enabled[0] ?? -1);
  }
  function openMenu(control, startAtEnd = false) {
    closeMenu();
    if (control.button.disabled) return;
    const { button, select, label } = control;
    current = control;
    list.setAttribute('aria-label', label);
    (button.closest('dialog[open]') ?? document.body).append(list);
    if (hasPopover) list.showPopover();
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', list.id);
    const selected = select.selectedIndex;
    drawOptions(selected < 0 && startAtEnd ? enabledOptions().at(-1) : selected);
  }
  function commit(index) {
    const { select, button, sync } = current;
    const option = select.options[index];
    if (!option || option.disabled || option.hidden) return;
    closeMenu();
    button.focus({ preventScroll: true });
    if (index === select.selectedIndex) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
  }
  function keydown(event, control) {
    const { key } = event;
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const opened = current === control;
    if (key === 'Tab' && opened) {
      closeMenu();
      return;
    }
    const motion = ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key);
    const type = key.length === 1 && key !== ' ';
    if (!opened && !motion && !type) return;
    if (!motion && !type && !['Escape', 'Enter', ' '].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'Escape') { closeMenu(); return; }
    if (!opened) openMenu(control, key === 'ArrowUp' || key === 'End');
    if (!current) return;
    if (key === 'Enter' || key === ' ') { commit(activeIndex); return; }
    const indices = enabledOptions();
    if (!indices.length) return;
    const index = indices.indexOf(activeIndex);
    if (key === 'Home') chooseActive(indices[0]);
    else if (key === 'End') chooseActive(indices.at(-1));
    else if (key === 'ArrowDown' && opened) chooseActive(indices[Math.min(index + 1, indices.length - 1)]);
    else if (key === 'ArrowUp' && opened) chooseActive(indices[Math.max(index - 1, 0)]);
    else if (type) {
      const now = performance.now();
      search = (now - searchAt < 650 ? search : '') + key.toLocaleLowerCase();
      searchAt = now;
      const repeated = [...search].every(char => char === search[0]);
      const term = repeated ? search[0] : search;
      const ordered = repeated ? indices.slice(index + 1).concat(indices.slice(0, index + 1)) : indices;
      const match = ordered.find(i => control.select.options[i].label.toLocaleLowerCase().startsWith(term));
      if (match !== undefined) chooseActive(match);
    }
  }
  function enhance(select) {
    const label = select.dataset.selectLabel;
    const wrapper = select.parentElement;
    const button = document.createElement('button');
    button.id = select.id + '-trigger';
    button.type = 'button';
    button.className = 'select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span');
    value.className = 'select-trigger-value';
    if (wrapper.classList.contains('picker')) {
      const prefix = document.createElement('span');
      prefix.className = 'picker-label';
      prefix.textContent = label;
      button.append(prefix);
    }
    button.append(value, icon('chevron'));
    for (const nativeLabel of [...select.labels]) nativeLabel.htmlFor = button.id;
    select.after(button);
    select.classList.add('select-backing');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    const control = { select, button, label, sync };
    function sync() {
      const text = select.selectedOptions[0]?.label || (select.id === 'agent' ? t('Not detected') : t('Please choose'));
      value.textContent = text;
      button.title = select.title || text;
      button.disabled = select.disabled || ![...select.options].some(option => !option.disabled && !option.hidden);
      button.hidden = select.hidden;
      button.setAttribute('aria-label', label + '，' + text);
      if (current === control) {
        if (button.disabled || button.hidden) closeMenu();
        else drawOptions(activeIndex);
      }
    }
    button.addEventListener('click', () => {
      if (current === control) closeMenu();
      else openMenu(control);
    });
    button.addEventListener('keydown', event => keydown(event, control));
    select.addEventListener('change', sync);
    select.form?.addEventListener('reset', () => queueMicrotask(sync));
    new MutationObserver(sync).observe(select, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'label', 'title', 'selected'],
    });
    sync();
  }

  // Keep focus on the combobox until a pointer selection commits.
  list.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('click', event => {
    const option = event.target.closest('.select-option');
    if (option && current) commit(Number(option.dataset.index));
  });
  document.addEventListener('pointerdown', event => {
    if (current && !current.button.contains(event.target) && !list.contains(event.target)) closeMenu();
  }, true);
  document.addEventListener('focusin', event => {
    if (current && !current.button.contains(event.target) && !list.contains(event.target)) closeMenu();
  });
  document.addEventListener('close', event => {
    if (current && event.target.contains(current.button)) closeMenu();
  }, true);
  document.addEventListener('scroll', event => { if (event.target !== list) positionMenu(); }, true);
  window.addEventListener('resize', positionMenu);
  window.visualViewport?.addEventListener('resize', positionMenu);
  window.visualViewport?.addEventListener('scroll', positionMenu);
  document.querySelectorAll('select[data-select-label]').forEach(enhance);
}
