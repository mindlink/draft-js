/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule DraftEditorCompositionHandler
 * @format
 * @flow
 */

'use strict';

import type DraftEditor from 'DraftEditor.react';

const DraftModifier = require('DraftModifier');
const EditorState = require('EditorState');
const Keys = require('Keys');
const UserAgent = require('UserAgent');

const getEntityKeyForSelection = require('getEntityKeyForSelection');
const isSelectionAtLeafStart = require('isSelectionAtLeafStart');
const isAndroid = UserAgent.isPlatform('Android');

/**
 * Millisecond delay to allow `compositionstart` to fire again upon
 * `compositionend`.
 *
 * This is used for Korean input to ensure that typing can continue without
 * the editor trying to render too quickly. More specifically, Safari 7.1+
 * triggers `compositionstart` a little slower than Chrome/FF, which
 * leads to composed characters being resolved and re-render occurring
 * sooner than we want.
 */
const RESOLVE_DELAY = 20;

/**
 * A handful of variables used to track the current composition and its
 * resolution status. These exist at the module level because it is not
 * possible to have compositions occurring in multiple editors simultaneously,
 * and it simplifies state management with respect to the DraftEditor component.
 */
let resolved = false;
let stillComposing = false;
let textInputData = '';
let setTimeoutId;
let formerTextInputData = '';

var DraftEditorCompositionHandler = {
  onBeforeInput: function(editor: DraftEditor, e: SyntheticInputEvent<>): void {
    textInputData = (textInputData || '') + e.data;
  },

  /**
   * A `compositionstart` event has fired while we're still in composition
   * mode. Continue the current composition session to prevent a re-render.
   */
  onCompositionStart: function(editor: DraftEditor, e: SyntheticInputEvent): void {
    formerTextInputData = e.data;
    stillComposing = true;
  },

  /**
   * Handle composition updates for Android.
   * This is because when autocomplete is enabled Android Chrome considers input to still be 
   * in the composing state until it is autocompleted or space is entered.
   */
  onCompositionUpdate: function(editor: DraftEditor, e: SyntheticInputEvent): void {
    if (!isAndroid) {
      return;
    }

    if (setTimeoutId) {
      clearTimeout(setTimeoutId);
    }

    resolved = false;
    formerTextInputData = textInputData;

    setTimeoutId = setTimeout((data) => {
      if (!resolved && stillComposing) {
        stillComposing = false;
        textInputData = (textInputData || '') + data;
        DraftEditorCompositionHandler.resolveComposition(editor);
      }
    }, 1, e.data);
  },

  /**
   * Attempt to end the current composition session.
   *
   * Defer handling because browser will still insert the chars into active
   * element after `compositionend`. If a `compositionstart` event fires
   * before `resolveComposition` executes, our composition session will
   * continue.
   *
   * The `resolved` flag is useful because certain IME interfaces fire the
   * `compositionend` event multiple times, thus queueing up multiple attempts
   * at handling the composition. Since handling the same composition event
   * twice could break the DOM, we only use the first event. Example: Arabic
   * Google Input Tools on Windows 8.1 fires `compositionend` three times.
   */
  onCompositionEnd: function(editor: DraftEditor): void {
    resolved = false;
    stillComposing = false;
    setTimeout(() => {
      if (!resolved) {
        DraftEditorCompositionHandler.resolveComposition(editor);
      }
    }, RESOLVE_DELAY);
  },

  /**
   * In Safari, keydown events may fire when committing compositions. If
   * the arrow keys are used to commit, prevent default so that the cursor
   * doesn't move, otherwise it will jump back noticeably on re-render.
   */
  onKeyDown: function(editor: DraftEditor, e: SyntheticKeyboardEvent<>): void {
    if (!stillComposing) {
      // If a keydown event is received after compositionend but before the
      // 20ms timer expires (ex: type option-E then backspace, or type A then
      // backspace in 2-Set Korean), we should immediately resolve the
      // composition and reinterpret the key press in edit mode.
      DraftEditorCompositionHandler.resolveComposition(editor);
      editor._onKeyDown(e);
      return;
    }
    if (e.which === Keys.RIGHT || e.which === Keys.LEFT) {
      e.preventDefault();
    }
  },

  /**
   * Keypress events may fire when committing compositions. In Firefox,
   * pressing RETURN commits the composition and inserts extra newline
   * characters that we do not want. `preventDefault` allows the composition
   * to be committed while preventing the extra characters.
   */
  onKeyPress: function(editor: DraftEditor, e: SyntheticKeyboardEvent<>): void {
    if (e.which === Keys.RETURN) {
      e.preventDefault();
    }
  },

  /**
   * Attempt to insert composed characters into the document.
   *
   * If we are still in a composition session, do nothing. Otherwise, insert
   * the characters into the document and terminate the composition session.
   *
   * If no characters were composed -- for instance, the user
   * deleted all composed characters and committed nothing new --
   * force a re-render. We also re-render when the composition occurs
   * at the beginning of a leaf, to ensure that if the browser has
   * created a new text node for the composition, we will discard it.
   *
   * Resetting innerHTML will move focus to the beginning of the editor,
   * so we update to force it back to the correct place.
   */
  resolveComposition: function(editor: DraftEditor): void {
    if (stillComposing) {
      return;
    }

    resolved = true;
    const composedChars = textInputData;
    textInputData = '';

    const formerComposedChars = formerTextInputData;
    formerTextInputData = '';

    const editorState = EditorState.set(editor._latestEditorState, {
      inCompositionMode: false,
    });

    const currentStyle = editorState.getCurrentInlineStyle();
    const entityKey = getEntityKeyForSelection(
      editorState.getCurrentContent(),
      editorState.getSelection(),
    );

    var domSelection = window.getSelection();
    var originalDomSelection = {
      anchorOffset: domSelection.anchorOffset,
      focusOffset: domSelection.focusOffset
    }

    const mustReset =
      !composedChars ||
      isSelectionAtLeafStart(editorState) ||
      currentStyle.size > 0 ||
      entityKey !== null;

    if (mustReset) {
      editor.restoreEditorDOM();
    }

    editor.exitCurrentMode();

    let contentState = editorState.getCurrentContent();
    let selection = editorState.getSelection();
    if (isAndroid && formerComposedChars && selection.isCollapsed()) {
      let anchorOffset = selection.getAnchorOffset() - formerComposedChars.length;
      if (anchorOffset < 0) {
        anchorOffset = 0;
      }
      const toRemoveSel = selection.merge({anchorOffset});
      contentState = DraftModifier.removeRange(
        editorState.getCurrentContent(),
        toRemoveSel,
        'backward',
      );
      selection = contentState.getSelectionAfter();
    }

    if (composedChars) {
      // If characters have been composed, re-rendering with the update
      // is sufficient to reset the editor.
      contentState = DraftModifier.replaceText(
        contentState,
        selection,
        composedChars,
        currentStyle,
        entityKey,
      );

      if (isAndroid && contentState.getSelectionAfter().anchorOffset > originalDomSelection.anchorOffset) {
        var startOffset = Math.min(originalDomSelection.anchorOffset, originalDomSelection.focusOffset);
        var endOffset = startOffset + Math.abs(originalDomSelection.focusOffset - originalDomSelection.anchorOffset);
        contentState = contentState.merge({
          selectionBefore: contentState.getSelectionAfter(),
          selectionAfter: selection.merge({
            anchorOffset: startOffset,
            focusOffset: endOffset })});
      }
      editor.update(
        EditorState.push(editorState, contentState, 'insert-characters'),
      );
      return;
    }

    if (mustReset) {
      editor.update(
        EditorState.set(editorState, {
          nativelyRenderedContent: null,
          forceSelection: true,
        }),
      );
    }
  },
};

module.exports = DraftEditorCompositionHandler;