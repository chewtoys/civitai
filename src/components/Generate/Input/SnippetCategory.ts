import Mention from '@tiptap/extension-mention';
import classes from './SnippetCategory.module.scss';

/**
 * Tiptap inline node for `#category` snippet references in the prompt editor.
 *
 * Built on top of `@tiptap/extension-mention` — same suggestion machinery,
 * different name + char + render. Mention's default `@user` semantics are
 * irrelevant here; we re-purpose the extension purely for the inline-atom
 * + popover-trigger behavior.
 *
 * Each chip stores its category name as `id` (matching Mention's contract).
 * `label` is preserved for forward-compat with future per-source display
 * tweaks (e.g. "character (My snippets)") — for v1 it equals `id`.
 *
 * `renderText` is what `editor.getText()` calls per node, and that's how
 * the form's plain-text value is produced. We always render `#${id}` so the
 * text round-trips through our own `parsePromptSnippetReferences` parser
 * unchanged.
 *
 * The `orphan` class is toggled via the node's `data-orphan` attribute when
 * post-mount validation flags a chip whose source category no longer
 * resolves. Detection is a future addition; the styling hook lives here so
 * the extension contract is stable.
 */
export const SnippetCategory = Mention.extend({
  name: 'snippetCategory',

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
      orphan: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-orphan') === 'true',
        renderHTML: (attrs) => (attrs.orphan ? { 'data-orphan': 'true' } : {}),
      },
    };
  },
}).configure({
  HTMLAttributes: {
    class: classes.snippetChip,
    'data-type': 'snippet-category',
  },
  renderText: ({ node }) => {
    const id = typeof node.attrs.id === 'string' ? node.attrs.id : '';
    return `#${id}`;
  },
  renderHTML: ({ node, options }) => {
    const id = typeof node.attrs.id === 'string' ? node.attrs.id : '';
    const orphan = !!node.attrs.orphan;
    const baseAttrs = (options?.HTMLAttributes ?? {}) as Record<string, unknown>;
    // Orphaned chips render a trailing "×" affordance so the user can dismiss
    // a chip whose source set/category no longer resolves. RichTextarea's
    // editor click handler intercepts clicks landing on `.snippetChipRemove`
    // and deletes the chip node — see `handleClickOn` there. Non-orphaned
    // chips render plain text (no remove affordance).
    const children: Array<string | unknown[]> = [`#${id}`];
    if (orphan) {
      children.push([
        'span',
        {
          class: classes.snippetChipRemove,
          'data-snippet-chip-remove': 'true',
          'aria-label': `Remove ${id}`,
          contenteditable: 'false',
        },
        '×',
      ]);
    }
    return [
      'span',
      {
        ...baseAttrs,
        'data-id': id || null,
        'data-label': node.attrs.label ?? null,
        'data-orphan': orphan ? 'true' : null,
        class: orphan ? `${classes.snippetChip} ${classes.orphan}` : classes.snippetChip,
      },
      ...children,
    ];
  },
});

// Public attrs shape exposed to consumers building docs programmatically
// (e.g. parsing a plain-text form value into a Tiptap doc on mount).
export type SnippetCategoryAttrs = {
  id: string;
  label?: string | null;
  orphan?: boolean;
};
