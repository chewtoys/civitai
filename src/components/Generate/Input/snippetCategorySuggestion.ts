import { computePosition, flip, shift } from '@floating-ui/dom';
import { posToDOMRect, ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';
import type { Editor } from '@tiptap/react';
import {
  SnippetCategoryList,
  type SnippetCategoryItem,
  type SnippetCategoryListRef,
} from './SnippetCategoryList';

/**
 * Build a SuggestionOptions for the SnippetCategory Tiptap node, configured
 * to pop on `#` and show a category picker.
 *
 * `getItems` is a function rather than a static array so the editor wrapper
 * can reach into a live store / query result without rebuilding the
 * extension on every render. The popover calls `getItems(query)` whenever
 * the user's typing changes; filtering / ordering / capping is the caller's
 * responsibility — we forward the filtered list straight to the renderer.
 */
export function createSnippetCategorySuggestion(
  getItems: (query: string) => SnippetCategoryItem[]
): Omit<SuggestionOptions<SnippetCategoryItem>, 'editor'> {
  return {
    char: '#',
    // Allow the suggestion to fire when `#` is typed at the start of input
    // OR after whitespace. Don't trigger when `#` is buried inside a word
    // (e.g. user types `foo#bar` — that's not a snippet ref start).
    allowSpaces: false,
    items: ({ query }) => getItems(query),
    render: () => {
      let component: ReactRenderer<SnippetCategoryListRef> | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(SnippetCategoryList, {
            props,
            editor: props.editor,
          });
          if (!props.clientRect) return;
          const el = component.element as HTMLElement;
          el.style.position = 'absolute';
          el.style.zIndex = '300';
          document.body.appendChild(el);
          updatePosition(props.editor, el);
        },

        onUpdate: (props) => {
          if (!component) return;
          component.updateProps(props);
          if (!props.clientRect) return;
          updatePosition(props.editor, component.element as HTMLElement);
        },

        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            component?.element.remove();
            component?.destroy();
            component = null;
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },

        onExit: () => {
          if (!component) return;
          component.element.remove();
          component.destroy();
          component = null;
        },
      };
    },
  };
}

/**
 * Floating-UI placement against the current selection — same pattern the
 * RichTextEditor's mention suggestion uses. Bottom-start with flip+shift
 * so the popover lands under the caret and keeps inside the viewport on
 * narrow forms.
 */
function updatePosition(editor: Editor, element: HTMLElement) {
  const virtualElement = {
    getBoundingClientRect: () =>
      posToDOMRect(editor.view, editor.state.selection.from, editor.state.selection.to),
  };
  computePosition(virtualElement, element, {
    placement: 'bottom-start',
    strategy: 'absolute',
    middleware: [shift({ padding: 8 }), flip()],
  }).then(({ x, y, strategy }) => {
    element.style.width = 'max-content';
    element.style.position = strategy;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  });
}
