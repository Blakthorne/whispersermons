/**
 * Quote Block TipTap Extension
 *
 * Custom extension for rendering and editing quote_block nodes in the editor.
 * Preserves quote metadata (reference, verification status, etc.) while
 * providing interactive features like drag-to-edit boundaries, quick actions, etc.
 *
 * This extension works with the AST-based DocumentState to maintain consistency
 * between the data model and the visual representation in TipTap.
 */

import { Node as TipTapNode, mergeAttributes } from '@tiptap/core';

export interface QuoteBlockAttrs {
  /** Unique identifier from the AST */
  nodeId?: string;
  /** Bible reference (e.g., "John 3:16") */
  reference?: string;
  /** Book name (e.g., "John") */
  book?: string;
  /** Chapter number */
  chapter?: number;
  /** Verse number or range */
  verse?: string;
  /** Start verse number */
  verseStart?: number;
  /** End verse number */
  verseEnd?: number;
  /** Original reference text as spoken */
  originalText?: string;
  /** Whether user verified this quote */
  userVerified?: boolean;
  /** Whether this quote contains text interjected by the speaker */
  hasInterjections?: boolean;
  /** Confidence score from whisper.cpp analysis (0-1) */
  confidence?: number;
  /** Whether marked as non-biblical */
  isNonBiblical?: boolean;
  /** Additional notes */
  notes?: string;
  /** Start character offset in original text */
  startOffset?: number;
  /** End character offset in original text */
  endOffset?: number;
  /** Last modified timestamp */
  modifiedAt?: string;
}

// Augment TipTap's Commands interface to include our custom commands
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    quote_block: {
      createQuoteBlock: (attrs: Partial<QuoteBlockAttrs>) => ReturnType;
      toggleQuoteBlock: () => ReturnType;
      updateQuoteAttrs: (attrs: Partial<QuoteBlockAttrs>) => ReturnType;
      verifyQuote: () => ReturnType;
      unverifyQuote: () => ReturnType;
      markNonBiblical: () => ReturnType;
      unmarkNonBiblical: () => ReturnType;
    };
  }
}

/**
 * Quote Block Node for TipTap
 *
 * Renders as a blockquote with data attributes for metadata preservation.
 * Metadata is stored in node.attrs and used by interactive overlays
 * (SelectionAdder, QuoteBoundaryEditor, FloatingEditBar).
 */
export const QuoteBlockExtension = TipTapNode.create({
  name: 'quote_block',

  group: 'block',

  // Allow block content (paragraphs) as the converter wraps text in paragraphs
  content: 'block+',

  // Allow marks inside quotes (bold, italic, etc.)
  marks: '_',

  draggable: false,

  selectable: true,

  /**
   * Configure node options
   */
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'bible-quote',
      },
    };
  },

  /**
   * Define node attributes for metadata
   */
  addAttributes() {
    return {
      nodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-node-id') || element.getAttribute('data-quote-id'),
        renderHTML: (attrs) => {
          if (!attrs.nodeId) return {};
          return {
            'data-node-id': attrs.nodeId,
          };
        },
      },
      reference: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-reference'),
        renderHTML: (attrs) => {
          if (!attrs.reference) return {};
          return {
            'data-reference': attrs.reference,
          };
        },
      },
      book: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-book'),
        renderHTML: (attrs) => {
          if (!attrs.book) return {};
          return {
            'data-book': attrs.book,
          };
        },
      },
      chapter: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-chapter');
          return val ? parseInt(val, 10) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.chapter === null) return {};
          return {
            'data-chapter': String(attrs.chapter),
          };
        },
      },
      verse: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-verse'),
        renderHTML: (attrs) => {
          if (!attrs.verse) return {};
          return {
            'data-verse': attrs.verse,
          };
        },
      },
      verseStart: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-verse-start');
          return val ? parseInt(val, 10) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.verseStart === null) return {};
          return {
            'data-verse-start': String(attrs.verseStart),
          };
        },
      },
      verseEnd: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-verse-end');
          return val ? parseInt(val, 10) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.verseEnd === null) return {};
          return {
            'data-verse-end': String(attrs.verseEnd),
          };
        },
      },
      originalText: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original-text'),
        renderHTML: (attrs) => {
          if (!attrs.originalText) return {};
          return {
            'data-original-text': attrs.originalText,
          };
        },
      },
      userVerified: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute('data-user-verified') === 'true',
        renderHTML: (attrs) => {
          return {
            'data-user-verified': attrs.userVerified ? 'true' : 'false',
          };
        },
      },
      hasInterjections: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute('data-has-interjections') === 'true',
        renderHTML: (attrs) => {
          return {
            'data-has-interjections': attrs.hasInterjections
              ? 'true'
              : 'false',
          };
        },
      },
      confidence: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-confidence');
          return val ? parseFloat(val) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.confidence === null) return {};
          return {
            'data-confidence': String(attrs.confidence),
          };
        },
      },
      isNonBiblical: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute('data-non-biblical') === 'true',
        renderHTML: (attrs) => {
          return {
            'data-non-biblical': attrs.isNonBiblical ? 'true' : 'false',
          };
        },
      },
      notes: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-notes'),
        renderHTML: (attrs) => {
          if (!attrs.notes) return {};
          return {
            'data-notes': attrs.notes,
          };
        },
      },
      startOffset: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-start-offset');
          return val ? parseInt(val, 10) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.startOffset === null) return {};
          return {
            'data-start-offset': String(attrs.startOffset),
          };
        },
      },
      endOffset: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-end-offset');
          return val ? parseInt(val, 10) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.endOffset === null) return {};
          return {
            'data-end-offset': String(attrs.endOffset),
          };
        },
      },
      modifiedAt: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-modified-at'),
        renderHTML: (attrs) => {
          if (!attrs.modifiedAt) return {};
          return {
            'data-modified-at': attrs.modifiedAt,
          };
        },
      },
    };
  },

  /**
   * Parse HTML into this node type
   * Handles both blockquote and our custom quote-block markup
   * Handles both blockquote and our custom bible-quote markup
   */
  parseHTML() {
    return [
      {
        tag: 'div[data-node-id]',
        preserveAttributes: true,
      },
      {
        tag: 'div[data-quote-id]',
        preserveAttributes: true,
      },
      {
        tag: 'div.bible-quote',
        preserveAttributes: true,
      },
      {
        tag: 'blockquote[data-node-id]',
        preserveAttributes: true,
      },
      {
        tag: 'blockquote[data-quote-id]',
        preserveAttributes: true,
      },
      {
        tag: 'blockquote.bible-quote',
        preserveAttributes: true,
      },
      {
        tag: 'blockquote',
        // Only parse regular blockquotes if no data attributes
        getAttrs: (element) => {
          const el = element as HTMLElement;
          // Skip if it has our quote-specific attributes
          if (
            el.hasAttribute('data-node-id') ||
            el.hasAttribute('data-quote-id') ||
            el.hasAttribute('data-reference')
          ) {
            return false;
          }
          // Regular blockquotes become quote blocks (convert them)
          return {
            reference: null,
            userVerified: false,
          };
        },
      },
    ];
  },

  /**
   * Render node as HTML
   */
  renderHTML({ HTMLAttributes }) {
    // Merge default attributes with any passed attrs
    const attrs = mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes
    );

    // Use a neutral class
    const classes = ['bible-quote'];

    return [
      'div',
      {
        ...attrs,
        class: classes.join(' '),
      },
      0, // Content placeholder
    ];
  },

  /**
   * Add keyboard shortcuts for quote operations
   */
  addKeyboardShortcuts() {
    return {
      // Cmd+/ to toggle quote block
      'Mod-/': () => this.editor.commands.toggleNode('quote_block', 'paragraph'),
    };
  },

  /**
   * Commands for quote operations
   */
  addCommands() {
    return {
      /**
       * Create a quote block from selected text
       */
      createQuoteBlock:
        (attrs: Partial<QuoteBlockAttrs>) =>
          ({ commands }: { commands: any }) => {
            return commands.wrapIn(this.name, {
              reference: attrs.reference || null,
              book: attrs.book || null,
              chapter: attrs.chapter || null,
              verse: attrs.verse || null,
              verseStart: attrs.verseStart || null,
              verseEnd: attrs.verseEnd || null,
              originalText: attrs.originalText || null,
              userVerified: false,
              isNonBiblical: false,
            });
          },

      /**
       * Toggle quote block on/off
       */
      toggleQuoteBlock:
        () =>
          ({ commands }: { commands: any }) => {
            return commands.toggleNode(this.name, 'paragraph');
          },

      /**
       * Update quote metadata
       */
      updateQuoteAttrs:
        (attrs: Partial<QuoteBlockAttrs>) =>
          ({ commands }: { commands: any }) => {
            return commands.updateAttributes(this.name, attrs);
          },

      /**
       * Mark quote as verified by user
       */
      verifyQuote:
        () =>
          ({ commands }: { commands: any }) => {
            return commands.updateAttributes(this.name, { userVerified: true });
          },

      /**
       * Unmark quote verification
       */
      unverifyQuote:
        () =>
          ({ commands }: { commands: any }) => {
            return commands.updateAttributes(this.name, {
              userVerified: false,
            });
          },

      /**
       * Mark quote as non-biblical
       */
      markNonBiblical:
        () =>
          ({ commands }: { commands: any }) => {
            return commands.updateAttributes(this.name, { isNonBiblical: true });
          },

      /**
       * Unmark quote as non-biblical
       */
      unmarkNonBiblical:
        () =>
          ({ commands }: { commands: any }) => {
            return commands.updateAttributes(this.name, {
              isNonBiblical: false,
            });
          },
    };
  },
});
