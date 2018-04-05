/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule editOnFocus
 * @format
 * 
 */

'use strict';

var EditorState = require('./EditorState');
var UserAgent = require('fbjs/lib/UserAgent');

function editOnFocus(editor, e) {
  var editorState = editor._latestEditorState;
  var currentSelection = editorState.getSelection();
  if (currentSelection.getHasFocus()) {
    return;
  }

  var selection = currentSelection.set('hasFocus', true);
  editor.props.onFocus && editor.props.onFocus(e);

  // Always force a selection to ensure that the input will return to the previous selection state.
  // Without this, programmatic focus would always reset to the start of the input.
  editor.update(EditorState.forceSelection(editorState, selection));
}

module.exports = editOnFocus;