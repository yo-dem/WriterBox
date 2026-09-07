(() => {
  'use strict';

  const editor = document.getElementById('editor');
  const toolbar = document.getElementById('toolbar');
  const saveIndicator = document.getElementById('save-indicator');
  const dragHandle = document.getElementById('drag-handle');

  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsClose = document.getElementById('settings-close');
  const settingsReset = document.getElementById('settings-reset');
  const widthOptions = document.getElementById('width-options');
  const fontFamilyOptions = document.getElementById('font-family-options');
  const fontSizeRange = document.getElementById('font-size-range');
  const fontSizeValue = document.getElementById('font-size-value');
  const lineHeightRange = document.getElementById('line-height-range');
  const lineHeightValue = document.getElementById('line-height-value');
  const paraSpacingRange = document.getElementById('para-spacing-range');
  const paraSpacingValue = document.getElementById('para-spacing-value');

  const lockIndicator = document.getElementById('lock-indicator');
  const lockOverlay = document.getElementById('lock-overlay');
  const lockClose = document.getElementById('lock-close');
  const lockForm = document.getElementById('lock-form');
  const lockUsername = document.getElementById('lock-username');
  const lockPassword = document.getElementById('lock-password');
  const lockError = document.getElementById('lock-error');
  const iconLockClosed = document.getElementById('icon-lock-closed');
  const iconLockOpen = document.getElementById('icon-lock-open');
  const btnBold = document.getElementById('btn-bold');
  const btnItalic = document.getElementById('btn-italic');
  const btnAlign = document.getElementById('btn-align');

  const STORAGE_KEY = 'writerbox.content';
  const THEME_KEY = 'writerbox.theme';
  const FONT_KEY = 'writerbox.fontsize';
  const FONT_FAMILY_KEY = 'writerbox.fontfamily';
  const DOCK_KEY = 'writerbox.dock';
  const WIDTH_KEY = 'writerbox.width';
  const LINE_HEIGHT_KEY = 'writerbox.lineheight';
  const PARA_SPACING_KEY = 'writerbox.paraspacing';
  const LOCK_KEY = 'writerbox.locked';

  const AUTH_USERS = { admin: 'admin' };

  let isLocked = false;

  const FONT_MIN = 13;
  const FONT_MAX = 34;
  const FONT_STEP = 2;
  const FONT_DEFAULT = 19;

  const FONT_FAMILY_PRESETS = {
    serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    sans: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", "Courier New", monospace'
  };

  const WIDTH_PRESETS = { small: '52ch', medium: '70ch', large: '92ch' };
  const LINE_HEIGHT_MIN = 1.2;
  const LINE_HEIGHT_MAX = 2.4;
  const LINE_HEIGHT_DEFAULT = 1.8;
  const PARA_SPACING_MIN = 0;
  const PARA_SPACING_MAX = 2.5;
  const PARA_SPACING_DEFAULT = 1;

  const TAB_SIZE = 6;

  const HISTORY_LIMIT = 100;
  let history = [];
  let historyIndex = -1;
  let isRestoringHistory = false;

  /* ---------- Init ---------- */

  function init() {
    document.execCommand('defaultParagraphSeparator', false, 'p');

    const savedContent = localStorage.getItem(STORAGE_KEY);
    editor.innerHTML = savedContent || '<p><br></p>';
    history = [editor.innerHTML];
    historyIndex = 0;

    const savedTheme = localStorage.getItem(THEME_KEY) ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(savedTheme);

    const savedFontFamily = localStorage.getItem(FONT_FAMILY_KEY) || 'serif';
    setFontFamily(savedFontFamily);

    const savedFont = parseInt(localStorage.getItem(FONT_KEY), 10);
    setFontSize(Number.isFinite(savedFont) ? savedFont : FONT_DEFAULT);

    const savedWidth = localStorage.getItem(WIDTH_KEY) || 'medium';
    setEditorWidth(savedWidth);

    const savedLineHeight = parseFloat(localStorage.getItem(LINE_HEIGHT_KEY));
    setLineHeight(Number.isFinite(savedLineHeight) ? savedLineHeight : LINE_HEIGHT_DEFAULT);

    const savedParaSpacing = parseFloat(localStorage.getItem(PARA_SPACING_KEY));
    setParaSpacing(Number.isFinite(savedParaSpacing) ? savedParaSpacing : PARA_SPACING_DEFAULT);

    const savedDock = localStorage.getItem(DOCK_KEY) || 'dock-top';
    setDock(savedDock);

    setLocked(localStorage.getItem(LOCK_KEY) === 'true');

    editor.focus();
    updateActiveStates();
  }

  /* ---------- Autosave ---------- */

  let saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer);
    localStorage.setItem(STORAGE_KEY, editor.innerHTML);
    flashSaved();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  let flashTimer = null;
  function flashSaved() {
    saveIndicator.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => saveIndicator.classList.remove('show'), 1200);
  }

  editor.addEventListener('input', scheduleSave);

  /* ---------- Markdown export ---------- */

  function inlineToMarkdown(node) {
    let result = '';
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        result += '  \n';
      } else if (tag === 'b' || tag === 'strong') {
        const inner = inlineToMarkdown(child);
        result += inner.trim() ? `**${inner}**` : inner;
      } else if (tag === 'i' || tag === 'em') {
        const inner = inlineToMarkdown(child);
        result += inner.trim() ? `*${inner}*` : inner;
      } else {
        result += inlineToMarkdown(child);
      }
    });
    return result;
  }

  function editorToMarkdown() {
    return Array.from(editor.children)
      .map(block => inlineToMarkdown(block))
      .join('\n\n');
  }

  function downloadMarkdown() {
    const firstLine = (editor.textContent.trim().split('\n')[0] || '').trim();
    const slug = firstLine
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    const blob = new Blob([editorToMarkdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (slug || 'documento') + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function saveAndDownload() {
    saveNow();
    downloadMarkdown();
  }

  /* ---------- Undo / Redo ---------- */

  // The browser's native undo stack only records execCommand-driven edits
  // (typing, Bold, Tab-insert) — it knows nothing about the direct DOM
  // surgery Allineamento performs, so relying on it leaves those actions
  // un-undoable and can desync the native stack entirely. We keep our own
  // snapshot-based history instead.

  let historyTimer = null;

  function commitHistorySnapshot() {
    if (isRestoringHistory) return;
    const html = editor.innerHTML;
    if (history[historyIndex] === html) return;
    history = history.slice(0, historyIndex + 1);
    history.push(html);
    if (history.length > HISTORY_LIMIT) history.shift();
    historyIndex = history.length - 1;
  }

  function pushHistory() {
    if (isRestoringHistory) return;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(commitHistorySnapshot, 400);
  }

  function restoreHistory(index) {
    isRestoringHistory = true;
    editor.innerHTML = history[index];
    isRestoringHistory = false;

    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    updateActiveStates();
  }

  function undo() {
    if (isLocked) return;
    clearTimeout(historyTimer);
    if (history.length === 0) return;
    // Flush whatever the editor currently holds (e.g. a pending debounced
    // edit) as the "present" checkpoint before stepping backwards.
    commitHistorySnapshot();
    if (historyIndex <= 0) return;
    historyIndex--;
    restoreHistory(historyIndex);
  }

  function redo() {
    if (isLocked) return;
    clearTimeout(historyTimer);
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    restoreHistory(historyIndex);
  }

  editor.addEventListener('input', pushHistory);

  /* ---------- Theme ---------- */

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Icon shows the mode a click will switch *to*: moon while light, sun while dark.
    document.getElementById('icon-sun').style.display = theme === 'dark' ? 'block' : 'none';
    document.getElementById('icon-moon').style.display = theme === 'dark' ? 'none' : 'block';
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  /* ---------- Zoom ---------- */

  function setFontSize(px) {
    const clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
    editor.style.setProperty('--editor-font-size', clamped + 'px');
    editor.style.fontSize = clamped + 'px';
    localStorage.setItem(FONT_KEY, String(clamped));
    fontSizeRange.value = String(clamped);
    fontSizeValue.textContent = clamped + 'px';
  }

  function zoom(delta) {
    const current = parseInt(getComputedStyle(editor).fontSize, 10) || FONT_DEFAULT;
    setFontSize(current + delta);
  }

  /* ---------- Editor settings (font / width / line-height / paragraph spacing) ---------- */

  function setFontFamily(mode) {
    const value = FONT_FAMILY_PRESETS[mode] ? mode : 'serif';
    editor.style.setProperty('--font-editor', FONT_FAMILY_PRESETS[value]);
    localStorage.setItem(FONT_FAMILY_KEY, value);
    Array.from(fontFamilyOptions.children).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.font === value);
    });
  }

  function setEditorWidth(mode) {
    const value = WIDTH_PRESETS[mode] ? mode : 'medium';
    document.documentElement.style.setProperty('--editor-max-width', WIDTH_PRESETS[value]);
    localStorage.setItem(WIDTH_KEY, value);
    Array.from(widthOptions.children).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.width === value);
    });
  }

  function setLineHeight(value) {
    const clamped = Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, value));
    document.documentElement.style.setProperty('--editor-line-height', String(clamped));
    localStorage.setItem(LINE_HEIGHT_KEY, String(clamped));
    lineHeightRange.value = String(clamped);
    lineHeightValue.textContent = clamped.toFixed(1);
  }

  function setParaSpacing(value) {
    const clamped = Math.min(PARA_SPACING_MAX, Math.max(PARA_SPACING_MIN, value));
    document.documentElement.style.setProperty('--editor-para-spacing', clamped + 'em');
    localStorage.setItem(PARA_SPACING_KEY, String(clamped));
    paraSpacingRange.value = String(clamped);
    paraSpacingValue.textContent = clamped.toFixed(1) + 'em';
  }

  function resetSettings() {
    setFontFamily('serif');
    setFontSize(FONT_DEFAULT);
    setEditorWidth('medium');
    setLineHeight(LINE_HEIGHT_DEFAULT);
    setParaSpacing(PARA_SPACING_DEFAULT);
  }

  fontFamilyOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented-btn');
    if (!btn) return;
    setFontFamily(btn.dataset.font);
  });

  widthOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented-btn');
    if (!btn) return;
    setEditorWidth(btn.dataset.width);
  });

  fontSizeRange.addEventListener('input', () => setFontSize(parseInt(fontSizeRange.value, 10)));
  lineHeightRange.addEventListener('input', () => setLineHeight(parseFloat(lineHeightRange.value)));
  paraSpacingRange.addEventListener('input', () => setParaSpacing(parseFloat(paraSpacingRange.value)));
  settingsReset.addEventListener('click', resetSettings);

  function openSettings() {
    settingsOverlay.classList.add('show');
    settingsOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeSettings() {
    settingsOverlay.classList.remove('show');
    settingsOverlay.setAttribute('aria-hidden', 'true');
  }

  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (settingsOverlay.classList.contains('show')) closeSettings();
    if (lockOverlay.classList.contains('show')) closeLockModal();
  });

  /* ---------- Block formatting ---------- */

  function getSelectedBlocks() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    let blocks = Array.from(editor.children).filter(el => range.intersectsNode(el));

    if (blocks.length === 0) {
      let node = sel.focusNode;
      if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      while (node && node.parentElement !== editor && node !== editor) node = node.parentElement;
      if (node && node.parentElement === editor) blocks = [node];
    }
    return blocks;
  }

  /* ---------- Alignment ---------- */

  const ALIGN_ORDER = ['left', 'center', 'right', 'justify'];

  function showAlignIcon(align) {
    ALIGN_ORDER.forEach(a => {
      document.getElementById('icon-align-' + a).style.display = (a === align) ? 'block' : 'none';
    });
  }

  function cycleAlign() {
    if (isLocked) return;
    editor.focus();
    const blocks = getSelectedBlocks();
    if (blocks.length === 0) return;

    const current = blocks[0].style.textAlign || 'left';
    const next = ALIGN_ORDER[(ALIGN_ORDER.indexOf(current) + 1) % ALIGN_ORDER.length];
    blocks.forEach(block => { block.style.textAlign = next; });

    showAlignIcon(next);
    scheduleSave();
    pushHistory();
    updateActiveStates();
  }

  /* ---------- Bold / Italic ---------- */

  function toggleBold() {
    if (isLocked) return;
    editor.focus();
    document.execCommand('bold');
    scheduleSave();
    pushHistory();
    updateActiveStates();
  }

  function toggleItalic() {
    if (isLocked) return;
    editor.focus();
    document.execCommand('italic');
    scheduleSave();
    pushHistory();
    updateActiveStates();
  }

  /* ---------- Toolbar active state feedback ---------- */

  function updateActiveStates() {
    const btnBold = document.getElementById('btn-bold');
    const btnItalic = document.getElementById('btn-italic');

    let bold = false, italic = false;
    try {
      bold = document.queryCommandState('bold');
      italic = document.queryCommandState('italic');
    } catch (e) { /* noop */ }
    btnBold.classList.toggle('active', bold);
    btnItalic.classList.toggle('active', italic);

    const blocks = getSelectedBlocks();
    if (blocks.length > 0) {
      showAlignIcon(blocks[0].style.textAlign || 'left');
    }
  }

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor || editor.contains(document.getSelection().anchorNode)) {
      updateActiveStates();
    }
  });

  /* ---------- Read-only lock ---------- */

  function setLocked(locked) {
    isLocked = locked;
    editor.contentEditable = locked ? 'false' : 'true';
    iconLockClosed.style.display = locked ? 'block' : 'none';
    iconLockOpen.style.display = locked ? 'none' : 'block';
    btnBold.disabled = locked;
    btnItalic.disabled = locked;
    btnAlign.disabled = locked;
    lockIndicator.classList.toggle('show', locked);
    localStorage.setItem(LOCK_KEY, locked ? 'true' : 'false');
  }

  function openLockModal() {
    lockForm.reset();
    lockError.textContent = '';
    lockOverlay.classList.add('show');
    lockOverlay.setAttribute('aria-hidden', 'false');
    lockUsername.focus();
  }

  function closeLockModal() {
    lockOverlay.classList.remove('show');
    lockOverlay.setAttribute('aria-hidden', 'true');
  }

  function toggleLock() {
    if (isLocked) {
      openLockModal();
    } else {
      setLocked(true);
    }
  }

  lockForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = lockUsername.value.trim();
    const password = lockPassword.value;

    if (AUTH_USERS[username] === password) {
      setLocked(false);
      closeLockModal();
      editor.focus();
    } else {
      lockError.textContent = 'Nome utente o password errati.';
      lockPassword.value = '';
      lockPassword.focus();
    }
  });

  lockClose.addEventListener('click', closeLockModal);
  lockOverlay.addEventListener('click', (e) => {
    if (e.target === lockOverlay) closeLockModal();
  });

  /* ---------- Toolbar actions ---------- */

  // Clicking a toolbar button would otherwise steal focus from #editor and
  // collapse/clear the current text selection before the click fires
  // (most noticeable in Safari) — keep the selection alive by preventing
  // the button's default mousedown behavior.
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button.tool')) e.preventDefault();
  });

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button.tool');
    if (!btn) return;
    switch (btn.dataset.cmd) {
      case 'bold': toggleBold(); break;
      case 'italic': toggleItalic(); break;
      case 'align': cycleAlign(); break;
      case 'zoom-in': zoom(FONT_STEP); break;
      case 'zoom-out': zoom(-FONT_STEP); break;
      case 'zoom-reset': setFontSize(FONT_DEFAULT); break;
      case 'theme': toggleTheme(); break;
      case 'lock-toggle': toggleLock(); break;
      case 'settings': openSettings(); break;
    }
  });

  /* ---------- Docking / dragging ---------- */

  function setDock(dockClass) {
    toolbar.classList.remove('dock-top', 'dock-bottom', 'dock-left', 'dock-right');
    toolbar.style.left = '';
    toolbar.style.top = '';
    toolbar.style.right = '';
    toolbar.style.bottom = '';
    toolbar.style.transform = '';
    toolbar.classList.add(dockClass);
    localStorage.setItem(DOCK_KEY, dockClass);
  }

  const COLLAPSE_SIZE = 46;

  let dragState = null;

  dragHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();

    // Pin the toolbar at its current on-screen spot (in viewport pixels,
    // regardless of whether that came from left/right/transform anchoring)
    // before dropping its dock class, so undocking never causes a jump.
    const oldRect = toolbar.getBoundingClientRect();
    toolbar.classList.add('dragging');
    toolbar.classList.remove('dock-top', 'dock-bottom', 'dock-left', 'dock-right');
    toolbar.style.transform = 'none';
    toolbar.style.left = oldRect.left + 'px';
    toolbar.style.top = oldRect.top + 'px';
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';

    // Animate the toolbar shrinking down to a small square holding just the
    // handle, so only that (small, consistently-sized) square needs to be
    // dragged around — this also sidesteps any width/height mismatch
    // between the vertical (narrow) and horizontal (wide) dock shapes.
    toolbar.style.width = oldRect.width + 'px';
    toolbar.style.height = oldRect.height + 'px';
    toolbar.classList.add('size-anim');
    toolbar.offsetHeight; // reflow: lock in the starting size before animating
    toolbar.classList.add('collapsed');
    toolbar.style.width = COLLAPSE_SIZE + 'px';
    toolbar.style.height = COLLAPSE_SIZE + 'px';

    dragState = {
      offsetX: COLLAPSE_SIZE / 2,
      offsetY: COLLAPSE_SIZE / 2,
      width: COLLAPSE_SIZE,
      height: COLLAPSE_SIZE,
      pointerX: e.clientX,
      pointerY: e.clientY
    };
    dragHandle.setPointerCapture(e.pointerId);
  });

  // Listening on window (not just the handle) means the drag keeps tracking
  // even if the pointer briefly leaves the handle or the document bounds —
  // setPointerCapture alone isn't enough once the cursor exits the browser
  // window, which is exactly when the drag used to get stuck.
  window.addEventListener('pointermove', (e) => {
    if (!dragState) return;

    // If the mouse button was released outside the window, we'd never get
    // a pointerup — but the next move event (once the cursor re-enters, or
    // even one that leaks through) reports buttons=0. Treat that as a stop.
    if (e.buttons === 0) {
      endDrag();
      return;
    }

    dragState.pointerX = e.clientX;
    dragState.pointerY = e.clientY;

    let x = e.clientX - dragState.offsetX;
    let y = e.clientY - dragState.offsetY;
    x = Math.min(window.innerWidth - dragState.width - 4, Math.max(4, x));
    y = Math.min(window.innerHeight - dragState.height - 4, Math.max(4, y));
    toolbar.style.left = x + 'px';
    toolbar.style.top = y + 'px';
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
  });

  // Releasing snaps the toolbar back to full size instantly — only the
  // collapse (on grab) is animated; animating the expand too made the
  // release feel sluggish/unpredictable.
  function expandToolbarToDock(dockClass) {
    setDock(dockClass);
    toolbar.classList.remove('dragging', 'collapsed', 'size-anim');
    toolbar.style.width = '';
    toolbar.style.height = '';
  }

  function endDrag() {
    if (!dragState) return;

    // Decide the target edge from where the pointer actually is, not from
    // the toolbar's own bounding box — it's a small fixed square during the
    // drag now, but using the cursor position keeps this correct regardless.
    const px = Math.min(window.innerWidth, Math.max(0, dragState.pointerX));
    const py = Math.min(window.innerHeight, Math.max(0, dragState.pointerY));

    const distTop = py;
    const distBottom = window.innerHeight - py;
    const distLeft = px;
    const distRight = window.innerWidth - px;

    const min = Math.min(distTop, distBottom, distLeft, distRight);
    let dock = 'dock-top';
    if (min === distBottom) dock = 'dock-bottom';
    else if (min === distLeft) dock = 'dock-left';
    else if (min === distRight) dock = 'dock-right';
    else dock = 'dock-top';

    expandToolbarToDock(dock);
    dragState = null;
  }

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  // Safety net: if the window loses focus mid-drag (e.g. the cursor moved
  // onto another app before releasing), don't leave the toolbar stuck.
  window.addEventListener('blur', () => { if (dragState) endDrag(); });

  /* ---------- Tab indent ---------- */

  function insertIndent() {
    if (isLocked) return;
    document.execCommand('insertText', false, '\xa0'.repeat(TAB_SIZE));
    scheduleSave();
    pushHistory();
  }

  function outdentAtCursor() {
    if (isLocked) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;

    const offset = range.startOffset;
    const text = node.textContent;
    let removeCount = 0;
    while (removeCount < TAB_SIZE && (text[offset - 1 - removeCount] === ' ' || text[offset - 1 - removeCount] === ' ')) {
      removeCount++;
    }
    if (removeCount === 0) return;

    const delRange = document.createRange();
    delRange.setStart(node, offset - removeCount);
    delRange.setEnd(node, offset);
    delRange.deleteContents();
    scheduleSave();
    pushHistory();
  }

  // Backspace right after a Tab-inserted indent removes the whole indent
  // in one press instead of deleting it one space at a time.
  function handleIndentBackspace() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;

    const offset = range.startOffset;
    const prevChar = node.textContent[offset - 1];
    if (prevChar !== ' ' && prevChar !== ' ') return false;

    outdentAtCursor();
    return true;
  }

  /* ---------- Keyboard shortcuts ---------- */

  // Registered on window (capture phase) rather than the editor, so
  // Ctrl/Cmd+S is caught and the browser's "Save Page" dialog is
  // suppressed no matter where focus currently is.
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveAndDownload();
    }
  }, true);

  editor.addEventListener('keydown', (e) => {
    // Tab would otherwise move focus out of the editor instead of typing.
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdentAtCursor(); else insertIndent();
      return;
    }

    if (e.key === 'Backspace') {
      if (handleIndentBackspace()) e.preventDefault();
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      redo();
      return;
    }

    if (key === 'b') {
      e.preventDefault();
      toggleBold();
    } else if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      zoom(FONT_STEP);
    } else if (e.key === '-') {
      e.preventDefault();
      zoom(-FONT_STEP);
    }
  });

  init();
})();
