import type { InputWrapperProps } from '@mantine/core';
import { Input } from '@mantine/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor, JSONContent } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { editPromptAttentionRange } from '~/components/ImageGeneration/GenerationForm/generation.utils';
import { parsePromptSnippetReferences } from '~/utils/prompt-helpers';
import { SnippetCategory } from './SnippetCategory';
import type { SnippetCategoryItem } from './SnippetCategoryList';
import { createSnippetCategorySuggestion } from './snippetCategorySuggestion';

/**
 * Standalone Tiptap-based textarea-style input for the GenerationForm.
 * Headless of any parent context (no react-hook-form, no `~/libs/form`
 * `useCustomFormContext`, no graph subscriptions) — drops in anywhere with
 * just `value` + `onChange`. GenerationForm-specific features are opt-in
 * per-instance via props:
 *
 *   - `snippets`           — `#category` chip rendering + autocomplete popover
 *   - `attentionEdit`      — mod+ArrowUp/Down weight nudging
 *   - `onSubmit`           — fires on mod+Enter; caller wires it to whatever
 *                            "submit the form" means in their context
 *   - `onPaste`            — observe paste events (e.g. detect "Steps: …")
 *
 * Sizing mirrors Mantine `Textarea`: `minRows` sets the empty-state height,
 * `maxRows` caps growth (scrolls past). Without `maxRows`, the editor grows
 * unboundedly with content (matching `autosize` Textarea).
 *
 * Form value is always a plain `string` round-tripped through Tiptap's
 * `getText()`. Snippet chips render `#${id}` so the serialized text matches
 * what `parsePromptSnippetReferences` and the server-side resolver expect.
 */

export type RichTextareaSnippetsConfig = {
  /** Category items shown in the `#` autocomplete popover. */
  categories: SnippetCategoryItem[];
};

export type RichTextareaProps = {
  // ──────────────── Form value ────────────────
  /** Plain-text value. */
  value?: string;
  /** Plain-text emitter — receives `editor.getText()` on every change. */
  onChange?: (value: string) => void;
  onBlur?: () => void;

  // ──────────────── Mantine Input.Wrapper passthrough ────────────────
  label?: InputWrapperProps['label'];
  description?: InputWrapperProps['description'];
  error?: InputWrapperProps['error'];
  withAsterisk?: InputWrapperProps['withAsterisk'];

  // ──────────────── Common input props ────────────────
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;

  // ──────────────── Sizing (mirrors Mantine Textarea) ────────────────
  /** Minimum visible rows when empty. Default 1. */
  minRows?: number;
  /** Maximum visible rows; scrolls past this. Omit for unbounded growth. */
  maxRows?: number;

  // ──────────────── Optional features (opt-in via props) ────────────────
  /**
   * Observe paste events on the editor. Receives the native `ClipboardEvent`
   * matching the contract callers in GenerationForm rely on
   * (`event.clipboardData.getData('text/plain')`). Observation only — the
   * default Tiptap paste behavior always proceeds.
   */
  onPaste?: (event: ClipboardEvent) => void;
  /**
   * Fires when the user presses mod+Enter in the editor. Caller decides what
   * "submit" means in their environment — this component intentionally
   * doesn't reach into any form context. When omitted, mod+Enter falls
   * through to the editor's default behavior.
   */
  onSubmit?: () => void;
  /** Enable mod+ArrowUp / mod+ArrowDown attention-weight editing. Default false. */
  attentionEdit?: boolean;
  /**
   * When provided, enables `#category` autocomplete + chip rendering. Omit
   * to render as a plain Tiptap textarea (no SnippetCategory extension
   * loaded; form value is purely whatever the user types).
   */
  snippets?: RichTextareaSnippetsConfig;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onBlur' | 'onPaste'>;

// Approximate per-row height for sizing math. Matches `text-sm` + `leading-snug`
// (1.375 line-height × 14px ≈ 19px, rounded with a hair of breathing room).
// Used only to translate `minRows`/`maxRows` into pixel min/max-height — the
// editor still auto-sizes naturally between those bounds.
const ROW_HEIGHT_PX = 22;
const SHELL_VERTICAL_PADDING_PX = 16; // py-2 → 8 + 8

export function RichTextarea({
  value = '',
  onChange,
  onBlur,
  onPaste,
  onSubmit,
  label,
  description,
  error,
  withAsterisk,
  placeholder,
  disabled,
  className,
  autoFocus,
  minRows = 1,
  maxRows,
  attentionEdit = false,
  snippets,
  ...rest
}: RichTextareaProps) {
  // Refs for parent-supplied callbacks / data: the suggestion plugin and
  // editor handlers are baked into the `useEditor` config that we
  // intentionally rebuild only on a tiny set of deps. Inline-arrow callers
  // would otherwise capture stale references.
  const onPasteRef = useRef(onPaste);
  useEffect(() => {
    onPasteRef.current = onPaste;
  }, [onPaste]);
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const snippetCategoriesRef = useRef<SnippetCategoryItem[]>(snippets?.categories ?? []);
  useEffect(() => {
    snippetCategoriesRef.current = snippets?.categories ?? [];
  }, [snippets?.categories]);

  // Configuration toggles also live in refs so the keydown handler can read
  // the current value without rebuilding the editor on every flag flip.
  const attentionEditRef = useRef(attentionEdit);
  useEffect(() => {
    attentionEditRef.current = attentionEdit;
  }, [attentionEdit]);

  // The SnippetCategory extension must be present at editor-build time to
  // be available — toggling the `snippets` prop on/off rebuilds the editor.
  // Inside a single editor lifetime, the categories list itself can change
  // freely (see snippetCategoriesRef) without remounting.
  const snippetsEnabled = !!snippets;

  const extensions = useMemo(() => {
    const list = [
      StarterKit.configure({
        // Prompts are flat text — disable every block-level structure so
        // Enter doesn't introduce paragraphs / lists / etc. that don't
        // round-trip cleanly through `editor.getText()`.
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
    ];
    if (snippetsEnabled) {
      list.push(
        SnippetCategory.configure({
          suggestion: createSnippetCategorySuggestion((query) => {
            const q = query.toLowerCase();
            return snippetCategoriesRef.current
              .filter((c) => (c.label ?? c.id).toLowerCase().startsWith(q))
              .slice(0, 8);
          }),
        }) as never
      );
    }
    return list;
  }, [snippetsEnabled]);

  const editor = useEditor(
    {
      extensions,
      // Tiptap needs DOM access; SSR pass would otherwise hydration-mismatch.
      immediatelyRender: false,
      content: parseTextToDoc(value, snippetsEnabled),
      editable: !disabled,
      onUpdate: ({ editor }) => {
        onChange?.(serializeEditorToText(editor));
      },
      onBlur: () => {
        onBlur?.();
      },
      editorProps: {
        attributes: {
          class: clsx(
            'tiptap-textarea-editor outline-none',
            // Mantine input-style baseline so the editor sits naturally
            // inside Input.Wrapper labels.
            'text-sm leading-snug'
          ),
          'data-placeholder': placeholder ?? (typeof label === 'string' ? label : ''),
        },
        handleKeyDown(_view, event) {
          const isMod = event.metaKey || event.ctrlKey;
          if (!isMod) return false;

          // mod+Enter — fire the caller's submit handler when present.
          // Without one, fall through (returning false) so Tiptap handles
          // the keystroke normally.
          if (event.key === 'Enter' && onSubmitRef.current) {
            event.preventDefault();
            onSubmitRef.current();
            return true;
          }

          // mod+ArrowUp / mod+ArrowDown — attention edit (opt-in, default
          // false). Run the shared text-only algorithm against a plain-text
          // view of the doc, then map char offsets back to ProseMirror
          // positions so the cursor lands inside the bumped weight ready
          // for repeated nudges.
          if (attentionEditRef.current && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            if (!editor) return false;
            const handled = applyAttentionEdit(editor, event.key === 'ArrowUp', snippetsEnabled);
            if (handled) {
              event.preventDefault();
              return true;
            }
          }

          return false;
        },
        handlePaste(_view, event) {
          // Observation hook — runs before Tiptap's default paste handling.
          // Always returns false so the default behavior continues; this
          // preserves the standard text paste-in semantics. Snippet chip
          // detection from pasted text happens via the doc round-trip
          // (paste → text → onChange → external value sync → setContent
          // with `parseTextToDoc` re-running the snippet parser).
          if (event instanceof ClipboardEvent) {
            onPasteRef.current?.(event);
          }
          return false;
        },
      },
    },
    // Rebuild only when the extension set or editable flag changes — content
    // sync is handled imperatively below so external value changes don't
    // tear down the editor and steal focus.
    [extensions, disabled]
  );

  // Sync external value changes (preset load, remix, parent-driven reset)
  // into the editor without rebuilding it. Compare against the editor's
  // own getText() to avoid stomping in-flight typing — onUpdate already
  // pushed a value up, and that re-entrant prop change would otherwise
  // cause a cursor-jump.
  useEffect(() => {
    if (!editor) return;
    const current = serializeEditorToText(editor);
    if (current === value) return;
    editor.commands.setContent(parseTextToDoc(value, snippetsEnabled), { emitUpdate: false });
  }, [editor, value, snippetsEnabled]);

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end');
  }, [autoFocus, editor]);

  // Sizing math: minRows establishes the empty-state height; maxRows caps
  // growth and switches the shell to scroll past that bound. Without
  // maxRows the editor grows freely with content.
  const shellStyle: CSSProperties = {
    minHeight: minRows * ROW_HEIGHT_PX + SHELL_VERTICAL_PADDING_PX,
    ...(typeof maxRows === 'number'
      ? { maxHeight: maxRows * ROW_HEIGHT_PX + SHELL_VERTICAL_PADDING_PX, overflowY: 'auto' }
      : null),
    ...rest.style,
  };

  return (
    <Input.Wrapper
      label={label}
      description={description}
      error={error}
      withAsterisk={withAsterisk}
    >
      <div
        {...rest}
        className={clsx(
          'tiptap-textarea-shell cursor-text rounded-md border border-solid px-3 py-2',
          'border-gray-3 bg-gray-0 dark:border-dark-4 dark:bg-dark-6',
          'focus-within:border-blue-5 dark:focus-within:border-blue-4',
          error && 'border-red-5 dark:border-red-5',
          disabled && 'opacity-60',
          className
        )}
        style={shellStyle}
        onMouseDown={(e) => {
          // Clicks anywhere in the padding / dead horizontal space inside
          // the shell focus the editor (matching <textarea> feel). When
          // the click lands inside the ProseMirror element itself, bail
          // out so the editor's own selection logic handles caret
          // placement at the click position.
          if (!editor || disabled) return;
          const editorEl = editor.view.dom;
          if (editorEl.contains(e.target as Node)) return;
          e.preventDefault();
          editor.commands.focus('end');
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </Input.Wrapper>
  );
}

/**
 * Convert a plain-text value into a Tiptap doc. When snippet support is
 * enabled, every `#category` reference becomes a `snippetCategory` inline
 * node; otherwise the text is a single literal text node. Either way the
 * doc serializes back through `editor.getText()` to the same source string.
 */
export function parseTextToDoc(text: string, snippetsEnabled: boolean): JSONContent {
  if (!text) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  if (!snippetsEnabled) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
  }
  const refs = parsePromptSnippetReferences(text);
  if (refs.length === 0) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
  }
  const inline: JSONContent[] = [];
  let cursor = 0;
  for (const ref of refs) {
    if (ref.start > cursor) {
      inline.push({ type: 'text', text: text.slice(cursor, ref.start) });
    }
    inline.push({
      type: 'snippetCategory',
      attrs: { id: ref.category, label: ref.category },
    });
    cursor = ref.end;
  }
  if (cursor < text.length) {
    inline.push({ type: 'text', text: text.slice(cursor) });
  }
  return { type: 'doc', content: [{ type: 'paragraph', content: inline }] };
}

/**
 * Read the editor's current value as a plain-text string. Tiptap's
 * `getText()` walks every node and (via the chip's `renderText`) emits
 * `#${id}` for snippet chips — so the form's serialized value matches
 * what `parsePromptSnippetReferences` and the server-side resolver expect.
 */
export function serializeEditorToText(editor: Editor): string {
  return editor.getText();
}

/**
 * Tiptap-aware port of `keyupEditAttention`. The shared text-only algorithm
 * lives in `editPromptAttentionRange`; this wrapper handles the editor's
 * own coordinate system: collapse the doc to a plain-text view, run the
 * algorithm, then write the result back via `setContent` and map the
 * post-edit selection back to ProseMirror positions so the caret lands
 * inside the bumped weight ready for repeated nudges.
 *
 * Returns `true` when the keystroke produced an edit, `false` otherwise.
 */
function applyAttentionEdit(editor: Editor, isPlus: boolean, snippetsEnabled: boolean): boolean {
  const leafText = (node: PMNode): string => {
    if (node.type.name === 'snippetCategory') {
      const id = (node.attrs.id ?? '') as string;
      return `#${id}`;
    }
    return '';
  };

  const docEnd = editor.state.doc.content.size;
  const text = editor.state.doc.textBetween(0, docEnd, '\n', leafText);
  const startChar = editor.state.doc.textBetween(
    0,
    editor.state.selection.from,
    '\n',
    leafText
  ).length;
  const endChar = editor.state.doc.textBetween(0, editor.state.selection.to, '\n', leafText).length;

  const result = editPromptAttentionRange(text, startChar, endChar, isPlus);
  if (!result) return false;

  // setContent rebuilds the doc synchronously; subsequent reads of editor.state
  // already reflect the new structure, so the offset-mapper below operates on
  // the post-edit doc.
  editor.commands.setContent(parseTextToDoc(result.text, snippetsEnabled));
  editor.commands.setTextSelection({
    from: charOffsetToPmPos(editor, result.selectionStart),
    to: charOffsetToPmPos(editor, result.selectionEnd),
  });
  editor.commands.focus();
  return true;
}

/**
 * Walk the doc inline-by-inline, accumulating the text-rendering length of
 * each node (text nodes use their literal text length; snippetCategory atoms
 * use `#${id}`'s length to match `editor.getText()`). When the accumulated
 * length reaches `charOffset`, emit the corresponding ProseMirror position.
 *
 * Atomic chips can't host a cursor; offsets that fall inside a chip's
 * rendered text round to the nearest chip boundary (start when `remaining
 * == 0`, otherwise the position after the chip).
 */
function charOffsetToPmPos(editor: Editor, charOffset: number): number {
  let remaining = charOffset;
  let result = -1;
  editor.state.doc.descendants((node, pmPos) => {
    if (result !== -1) return false;
    if (node.isText) {
      const len = (node.text ?? '').length;
      if (remaining <= len) {
        result = pmPos + remaining;
        return false;
      }
      remaining -= len;
      return true;
    }
    if (node.type.name === 'snippetCategory') {
      const id = (node.attrs.id ?? '') as string;
      const len = `#${id}`.length;
      if (remaining < len) {
        result = remaining === 0 ? pmPos : pmPos + 1;
        return false;
      }
      remaining -= len;
      return true;
    }
    return true;
  });
  if (result === -1) result = editor.state.doc.content.size;
  return result;
}
