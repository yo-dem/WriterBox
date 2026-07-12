(() => {
  'use strict';

  const editor = document.getElementById('editor');
  const toolbar = document.getElementById('toolbar');
  const saveIndicator = document.getElementById('save-indicator');
  const dragHandle = document.getElementById('drag-handle');

  const STORAGE_KEY = 'writerbox.content';
  const THEME_KEY = 'writerbox.theme';
  const FONT_KEY = 'writerbox.fontsize';
  const DOCK_KEY = 'writerbox.dock';

  const FONT_MIN = 13;
  const FONT_MAX = 34;
  const FONT_STEP = 2;

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

    const savedFont = parseInt(localStorage.getItem(FONT_KEY), 10);
    setFontSize(Number.isFinite(savedFont) ? savedFont : 19);

    const savedDock = localStorage.getItem(DOCK_KEY) || 'dock-top';
    setDock(savedDock);

    editor.focus();
    updateActiveStates();
  }

  /* ---------- Autosave ---------- */

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, editor.innerHTML);
      flashSaved();
    }, 400);
  }

  let flashTimer = null;
  function flashSaved() {
    saveIndicator.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => saveIndicator.classList.remove('show'), 1200);
  }

  editor.addEventListener('input', scheduleSave);

  /* ---------- Undo / Redo ---------- */

  // The browser's native undo stack only records execCommand-driven edits
  // (typing, Bold, Tab-insert) — it knows nothing about the direct DOM
  // surgery Titolo/Allineamento perform, so relying on it leaves
  // those actions un-undoable and can desync the native stack entirely.
  // We keep our own snapshot-based history instead.

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
  }

  function zoom(delta) {
    const current = parseInt(getComputedStyle(editor).fontSize, 10) || 19;
    setFontSize(current + delta);
  }

  /* ---------- Block formatting (Titolo / Testo) ---------- */

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

  /* ---------- Title (inline toggle, exact-selection) ---------- */

  // Temporary marker elements let us hold on to the boundaries of a
  // selection while we mutate the DOM around it (splitting/unwrapping
  // .wb-title spans), since a live Range's boundaries auto-adjust as
  // nodes are inserted/removed near them, but a plain (node, offset)
  // pair does not survive those mutations reliably.
  function placeBookmarks(range) {
    const startMarker = document.createElement('span');
    startMarker.className = 'wb-bookmark';
    const endMarker = document.createElement('span');
    endMarker.className = 'wb-bookmark';

    const endPoint = range.cloneRange();
    endPoint.collapse(false);
    endPoint.insertNode(endMarker);

    const startPoint = range.cloneRange();
    startPoint.collapse(true);
    startPoint.insertNode(startMarker);

    return { startMarker, endMarker };
  }

  function rangeBetweenBookmarks(startMarker, endMarker) {
    const range = document.createRange();
    range.setStartAfter(startMarker);
    range.setEndBefore(endMarker);
    return range;
  }

  // Removes .wb-title formatting from whatever part of `range` currently
  // has it, splitting each affected span so text outside the range keeps
  // its title formatting untouched.
  function clearTitleInRange(range) {
    const spans = Array.from(editor.querySelectorAll('.wb-title'))
      .filter(span => range.intersectsNode(span));

    spans.forEach(span => {
      const spanRange = document.createRange();
      spanRange.selectNodeContents(span);

      const startsBeforeSpan = range.compareBoundaryPoints(Range.START_TO_START, spanRange) <= 0;
      const endsAfterSpan = range.compareBoundaryPoints(Range.END_TO_END, spanRange) >= 0;

      const overlapStart = startsBeforeSpan
        ? { node: spanRange.startContainer, offset: spanRange.startOffset }
        : { node: range.startContainer, offset: range.startOffset };
      const overlapEnd = endsAfterSpan
        ? { node: spanRange.endContainer, offset: spanRange.endOffset }
        : { node: range.endContainer, offset: range.endOffset };

      const beforeRange = document.createRange();
      beforeRange.setStart(spanRange.startContainer, spanRange.startOffset);
      beforeRange.setEnd(overlapStart.node, overlapStart.offset);

      const overlapRange = document.createRange();
      overlapRange.setStart(overlapStart.node, overlapStart.offset);
      overlapRange.setEnd(overlapEnd.node, overlapEnd.offset);

      const afterRange = document.createRange();
      afterRange.setStart(overlapEnd.node, overlapEnd.offset);
      afterRange.setEnd(spanRange.endContainer, spanRange.endOffset);

      // Extract right-to-left: extracting a later range never invalidates
      // the (node, offset) boundaries of an earlier, still-pending range.
      const afterFrag = afterRange.extractContents();
      const overlapFrag = overlapRange.extractContents();
      const beforeFrag = beforeRange.extractContents();

      const replacement = [];
      if (beforeFrag.textContent.length > 0) {
        const beforeSpan = document.createElement('span');
        beforeSpan.className = 'wb-title';
        beforeSpan.appendChild(beforeFrag);
        replacement.push(beforeSpan);
      }
      replacement.push(...Array.from(overlapFrag.childNodes));
      if (afterFrag.textContent.length > 0) {
        const afterSpan = document.createElement('span');
        afterSpan.className = 'wb-title';
        afterSpan.appendChild(afterFrag);
        replacement.push(afterSpan);
      }
      span.replaceWith(...replacement);
    });
  }

  // Clamps `range` to the portion that falls inside `block` (a top-level
  // #editor child), so callers never build a range that crosses out of it.
  function clampRangeToBlock(range, block) {
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);

    const start = range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0
      ? { node: blockRange.startContainer, offset: blockRange.startOffset }
      : { node: range.startContainer, offset: range.startOffset };
    const end = range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0
      ? { node: blockRange.endContainer, offset: blockRange.endOffset }
      : { node: range.endContainer, offset: range.endOffset };

    const clamped = document.createRange();
    clamped.setStart(start.node, start.offset);
    clamped.setEnd(end.node, end.offset);
    return clamped;
  }

  function wrapRangeInTitle(range) {
    // A <span> can only legally hold inline content — if the selection
    // spans multiple paragraphs, wrapping it whole would nest block
    // elements (<p>) inside an inline one, producing broken HTML that
    // browsers render unpredictably (stray line breaks). Give each
    // paragraph in the selection its own title span instead.
    const blocks = Array.from(editor.children).filter(el => range.intersectsNode(el));

    if (blocks.length <= 1) {
      const span = document.createElement('span');
      span.className = 'wb-title';
      span.appendChild(range.extractContents());
      range.insertNode(span);
      return;
    }

    // Right-to-left so extracting from a later block never invalidates
    // the (node, offset) boundaries of an earlier, still-pending block.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const blockRange = clampRangeToBlock(range, blocks[i]);
      if (blockRange.collapsed) continue;
      const span = document.createElement('span');
      span.className = 'wb-title';
      span.appendChild(blockRange.extractContents());
      blockRange.insertNode(span);
    }
  }

  // True only if every character of text within `range` already sits
  // inside a .wb-title span.
  function isRangeFullyTitled(range) {
    const root = range.commonAncestorContainer;

    // A TreeWalker never visits its own root, only descendants — when the
    // whole selection sits inside one text node (the common case), the
    // walker below would find nothing. Handle that directly.
    if (root.nodeType === Node.TEXT_NODE) {
      return root.textContent.length > 0 && !!root.parentElement && !!root.parentElement.closest('.wb-title');
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return (range.intersectsNode(node) && node.textContent.length > 0)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    let foundText = false;
    let node;
    while ((node = walker.nextNode())) {
      foundText = true;
      if (!node.parentElement || !node.parentElement.closest('.wb-title')) return false;
    }
    return foundText;
  }

  function withBookmarkedSelection(mutate) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const original = sel.getRangeAt(0);
    if (!editor.contains(original.commonAncestorContainer)) return;

    const { startMarker, endMarker } = placeBookmarks(original);
    mutate(() => rangeBetweenBookmarks(startMarker, endMarker));

    const finalRange = rangeBetweenBookmarks(startMarker, endMarker);
    startMarker.remove();
    endMarker.remove();
    sel.removeAllRanges();
    sel.addRange(finalRange);

    scheduleSave();
    pushHistory();
    updateActiveStates();
  }

  function toggleTitle() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const makeTitle = !isRangeFullyTitled(sel.getRangeAt(0));

    withBookmarkedSelection((getRange) => {
      clearTitleInRange(getRange());
      if (makeTitle) wrapRangeInTitle(getRange());
    });
  }

  /* ---------- Alignment ---------- */

  const ALIGN_ORDER = ['left', 'center', 'right', 'justify'];

  function showAlignIcon(align) {
    ALIGN_ORDER.forEach(a => {
      document.getElementById('icon-align-' + a).style.display = (a === align) ? 'block' : 'none';
    });
  }

  function cycleAlign() {
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

  /* ---------- Bold / Italic / Strikethrough ---------- */

  function toggleBold() {
    editor.focus();
    document.execCommand('bold');
    scheduleSave();
    pushHistory();
    updateActiveStates();
  }

  function toggleItalic() {
    editor.focus();
    document.execCommand('italic');
    scheduleSave();
    pushHistory();
    updateActiveStates();
  }

  function toggleStrike() {
    editor.focus();
    document.execCommand('strikeThrough');
    scheduleSave();
    pushHistory();
    updateActiveStates();
  }

  /* ---------- Toolbar active state feedback ---------- */

  function updateActiveStates() {
    const btnBold = document.getElementById('btn-bold');
    const btnItalic = document.getElementById('btn-italic');
    const btnStrike = document.getElementById('btn-strike');
    const btnTitle = document.getElementById('btn-title');

    let bold = false, italic = false, strike = false;
    try {
      bold = document.queryCommandState('bold');
      italic = document.queryCommandState('italic');
      strike = document.queryCommandState('strikeThrough');
    } catch (e) { /* noop */ }
    btnBold.classList.toggle('active', bold);
    btnItalic.classList.toggle('active', italic);
    btnStrike.classList.toggle('active', strike);

    const sel = window.getSelection();
    const hasSelection = sel.rangeCount > 0 && !sel.isCollapsed && editor.contains(sel.anchorNode);
    btnTitle.disabled = !hasSelection;
    btnTitle.classList.toggle('active', hasSelection && isRangeFullyTitled(sel.getRangeAt(0)));

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
      case 'title': toggleTitle(); break;
      case 'bold': toggleBold(); break;
      case 'italic': toggleItalic(); break;
      case 'strike': toggleStrike(); break;
      case 'align': cycleAlign(); break;
      case 'zoom-in': zoom(FONT_STEP); break;
      case 'zoom-out': zoom(-FONT_STEP); break;
      case 'theme': toggleTheme(); break;
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
    document.execCommand('insertText', false, '\xa0'.repeat(TAB_SIZE));
    scheduleSave();
    pushHistory();
  }

  function outdentAtCursor() {
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
