import { Document, Paragraph, TextRun, AlignmentType, Packer, HeadingLevel } from 'docx';
import { jsPDF } from 'jspdf';
import { TIMESTAMP_REGEX } from './vtt-parser';

interface ExportOptions {
  title?: string;
  fileName?: string;
  /** HTML content from the WYSIWYG editor */
  html?: string;
  /** Whether this is a sermon document */
  isSermon?: boolean;
}

/**
 * Generate Word document buffer from transcription text
 */
export async function generateWordDocument(
  text: string,
  options: ExportOptions = {}
): Promise<Buffer> {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text parameter: expected non-empty string');
  }

  const { title = 'Transcription', fileName = 'transcription' } = options;

  const lines = text.split('\n').filter((line) => line.trim());
  const paragraphs: Paragraph[] = [];

  // Add title
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 32, // 16pt
        }),
      ],
      spacing: { after: 400 },
      alignment: AlignmentType.CENTER,
    })
  );

  // Add metadata
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `File: ${fileName}`,
          italics: true,
          size: 20, // 10pt
        }),
      ],
      spacing: { after: 200 },
    })
  );

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date().toLocaleString()}`,
          italics: true,
          size: 20, // 10pt
        }),
      ],
      spacing: { after: 400 },
    })
  );

  // Process transcription content
  let currentTimestamp = '';
  let currentText = '';
  let hasStructuredContent = false;

  for (const line of lines) {
    if (line.startsWith('WEBVTT')) continue;

    const timestampMatch = line.match(TIMESTAMP_REGEX);

    if (timestampMatch) {
      if (currentText.trim()) {
        hasStructuredContent = true;
        paragraphs.push(
          new Paragraph({
            children: [
              ...(currentTimestamp
                ? [
                    new TextRun({
                      text: currentTimestamp,
                      color: '666666',
                      size: 18,
                    }),
                    new TextRun({
                      text: '\n',
                      size: 18,
                    }),
                  ]
                : []),
              new TextRun({
                text: currentText.trim(),
                size: 22, // 11pt
              }),
            ],
            spacing: { after: 200 },
          })
        );
      }
      currentTimestamp = line.trim();
      currentText = '';
    } else {
      currentText += (currentText ? ' ' : '') + line.trim();
    }
  }

  // Add last segment
  if (currentText.trim()) {
    hasStructuredContent = true;
    paragraphs.push(
      new Paragraph({
        children: [
          ...(currentTimestamp
            ? [
                new TextRun({
                  text: currentTimestamp,
                  color: '666666',
                  size: 18,
                }),
                new TextRun({
                  text: '\n',
                  size: 18,
                }),
              ]
            : []),
          new TextRun({
            text: currentText.trim(),
            size: 22, // 11pt
          }),
        ],
        spacing: { after: 200 },
      })
    );
  }

  // Fallback for unstructured text
  if (!hasStructuredContent && lines.length > 0) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: text,
            size: 22,
          }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Generate PDF document buffer from transcription text
 */
export async function generatePdfDocument(
  text: string,
  options: ExportOptions = {}
): Promise<Buffer> {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text parameter: expected non-empty string');
  }

  const { title = 'Transcription', fileName = 'transcription' } = options;

  // Create PDF document
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  // Add title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, pageWidth / 2, y, { align: 'center' });
  y += 10;

  // Add metadata
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100);
  doc.text(`File: ${fileName}`, margin, y);
  y += 5;
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
  y += 15;

  // Reset font for content
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);

  const lines = text.split('\n').filter((line) => line.trim());
  let currentTimestamp = '';
  let currentText = '';
  let hasStructuredContent = false;

  const addParagraph = (timestamp: string, content: string) => {
    // Check if we need a new page
    if (y > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }

    if (timestamp) {
      doc.setTextColor(100);
      doc.setFontSize(9);
      doc.text(timestamp, margin, y);
      y += 5;
    }

    doc.setTextColor(0);
    doc.setFontSize(11);

    const splitText = doc.splitTextToSize(content, contentWidth);
    doc.text(splitText, margin, y);
    y += splitText.length * 5 + 5; // Line height + spacing
  };

  for (const line of lines) {
    if (line.startsWith('WEBVTT')) continue;

    const timestampMatch = line.match(TIMESTAMP_REGEX);

    if (timestampMatch) {
      if (currentText.trim()) {
        hasStructuredContent = true;
        addParagraph(currentTimestamp, currentText.trim());
      }
      currentTimestamp = line.trim();
      currentText = '';
    } else {
      currentText += (currentText ? ' ' : '') + line.trim();
    }
  }

  // Add last segment
  if (currentText.trim()) {
    hasStructuredContent = true;
    addParagraph(currentTimestamp, currentText.trim());
  }

  // Fallback for unstructured text
  if (!hasStructuredContent && lines.length > 0) {
    const splitText = doc.splitTextToSize(text, contentWidth);
    doc.text(splitText, margin, y);
  }

  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Markdown document from transcription text
 */
export function generateMarkdownDocument(text: string, options: ExportOptions = {}): string {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text parameter: expected non-empty string');
  }

  const { title = 'Transcription', fileName = 'transcription' } = options;

  let markdown = `# ${title}\n\n`;
  markdown += `*File: ${fileName}*\n`;
  markdown += `*Generated: ${new Date().toLocaleString()}*\n\n`;
  markdown += `---\n\n`;

  const lines = text.split('\n').filter((line) => line.trim());
  let currentTimestamp = '';
  let currentText = '';
  let hasStructuredContent = false;

  for (const line of lines) {
    if (line.startsWith('WEBVTT')) continue;

    const timestampMatch = line.match(TIMESTAMP_REGEX);

    if (timestampMatch) {
      if (currentText.trim()) {
        hasStructuredContent = true;
        if (currentTimestamp) {
          markdown += `**${currentTimestamp}**\n\n`;
        }
        markdown += `${currentText.trim()}\n\n`;
      }
      currentTimestamp = line.trim();
      currentText = '';
    } else {
      currentText += (currentText ? ' ' : '') + line.trim();
    }
  }

  // Add last segment
  if (currentText.trim()) {
    hasStructuredContent = true;
    if (currentTimestamp) {
      markdown += `**${currentTimestamp}**\n\n`;
    }
    markdown += `${currentText.trim()}\n\n`;
  }

  // Fallback for unstructured text
  if (!hasStructuredContent && lines.length > 0) {
    markdown += text;
  }

  return markdown;
}

/**
 * Strip HTML tags and convert to plain text
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  
  // Replace block elements with newlines
  let text = html
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/blockquote>/gi, '\n\n');
  
  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
  
  // Clean up whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return text;
}

/**
 * Convert HTML to plain text for sermon export.
 * Sermon text export format:
 * - Title as first line
 * - Tags below title (if present)
 * - Primary Reference(s)
 * - References from the Sermon
 * - Separator line
 * - Body content
 * - No header metadata (File:, Generated:)
 */
export function htmlToSermonPlainText(html: string): string {
  if (!html) return '';
  
  // Replace block elements with newlines
  let text = html
    .replace(/<\/h1>/gi, '\n\n')
    .replace(/<\/h[2-6]>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/blockquote>/gi, '\n\n');
  
  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
  
  // Clean up whitespace - preserve double newlines for paragraphs but reduce excessive whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return text;
}

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  
  let md = html;
  
  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');
  
  // Bold and italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  md = md.replace(/<u[^>]*>(.*?)<\/u>/gi, '_$1_');
  
  // Highlights (scripture references)
  md = md.replace(/<mark[^>]*>(.*?)<\/mark>/gi, '==$1==');
  
  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // Blockquotes
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_, content) => {
    const lines = content.replace(/<[^>]+>/g, '').trim().split('\n');
    return lines.map((line: string) => `> ${line}`).join('\n') + '\n\n';
  });
  
  // Lists
  md = md.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (_, content) => {
    return content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n') + '\n';
  });
  md = md.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (_, content) => {
    let i = 1;
    return content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${i++}. $1\n`) + '\n';
  });
  
  // Paragraphs and breaks
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n\n');
  
  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  md = md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
  
  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  
  return md;
}

/**
 * Text run with formatting info for Word/PDF export
 */
interface FormattedTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * Parsed element with rich formatting support
 */
interface ParsedElementWithFormatting {
  type: 'heading' | 'paragraph' | 'blockquote' | 'list' | 'hr';
  level?: number;
  runs: FormattedTextRun[];
  alignment?: 'left' | 'center' | 'right';
}

/**
 * Parse inline formatting from HTML content into text runs
 */
function parseInlineFormatting(html: string): FormattedTextRun[] {
  const runs: FormattedTextRun[] = [];
  
  // Decode HTML entities
  const decodeEntities = (text: string): string => {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#x27;/g, "'");
  };
  
  // Track formatting state
  let currentText = '';
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let pos = 0;
  
  const flushRun = () => {
    if (currentText) {
      runs.push({
        text: decodeEntities(currentText),
        bold: isBold,
        italic: isItalic,
        underline: isUnderline,
      });
      currentText = '';
    }
  };
  
  while (pos < html.length) {
    // Check for tags
    if (html[pos] === '<') {
      const tagEnd = html.indexOf('>', pos);
      if (tagEnd === -1) {
        currentText += html[pos];
        pos++;
        continue;
      }
      
      const tag = html.substring(pos, tagEnd + 1);
      const tagLower = tag.toLowerCase();
      
      // Handle formatting tags
      if (tagLower === '<strong>' || tagLower === '<b>') {
        flushRun();
        isBold = true;
      } else if (tagLower === '</strong>' || tagLower === '</b>') {
        flushRun();
        isBold = false;
      } else if (tagLower === '<em>' || tagLower === '<i>') {
        flushRun();
        isItalic = true;
      } else if (tagLower === '</em>' || tagLower === '</i>') {
        flushRun();
        isItalic = false;
      } else if (tagLower === '<u>') {
        flushRun();
        isUnderline = true;
      } else if (tagLower === '</u>') {
        flushRun();
        isUnderline = false;
      }
      // Skip other tags
      
      pos = tagEnd + 1;
    } else {
      currentText += html[pos];
      pos++;
    }
  }
  
  flushRun();
  
  // If no runs were created, return the plain text
  if (runs.length === 0 && html.trim()) {
    runs.push({ text: decodeEntities(html.replace(/<[^>]+>/g, '')) });
  }
  
  return runs;
}

/**
 * Parse HTML content into elements with full formatting support
 */
function parseHtmlToElementsWithFormatting(html: string): ParsedElementWithFormatting[] {
  const elements: ParsedElementWithFormatting[] = [];
  
  // Updated regex to capture the full opening tag with attributes
  const blockRegex = /<(h[1-6]|p|blockquote|ul|ol|hr)([^>]*)>(.*?)<\/\1>|<hr\s*\/?>/gis;
  let match;
  
  // Helper to extract alignment from style attribute
  const extractAlignment = (attrs: string): 'left' | 'center' | 'right' | undefined => {
    const styleMatch = attrs.match(/style\s*=\s*["']([^"']+)["']/i);
    if (styleMatch && styleMatch[1]) {
      const alignMatch = styleMatch[1].match(/text-align\s*:\s*(left|center|right)/i);
      if (alignMatch && alignMatch[1]) {
        return alignMatch[1].toLowerCase() as 'left' | 'center' | 'right';
      }
    }
    return undefined;
  };
  
  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1]?.toLowerCase();
    const attrs = match[2] || '';
    const content = match[3] || '';
    
    if (tag === 'hr' || match[0].match(/<hr/i)) {
      elements.push({ type: 'hr', runs: [] });
      continue;
    }
    
    const runs = parseInlineFormatting(content);
    const alignment = extractAlignment(attrs);
    
    if (runs.length === 0 || (runs.length === 1 && runs[0] && !runs[0].text.trim())) {
      continue;
    }
    
    if (tag && tag.startsWith('h')) {
      const level = parseInt(tag.charAt(1) || '2', 10);
      elements.push({ type: 'heading', level, runs, alignment });
    } else if (tag === 'blockquote') {
      elements.push({ type: 'blockquote', runs, alignment });
    } else if (tag === 'ul' || tag === 'ol') {
      elements.push({ type: 'list', runs, alignment });
    } else {
      elements.push({ type: 'paragraph', runs, alignment });
    }
  }
  
  // If no block elements found, treat as plain text
  if (elements.length === 0 && html.trim()) {
    const runs = parseInlineFormatting(html);
    if (runs.length > 0) {
      elements.push({ type: 'paragraph', runs });
    }
  }
  
  return elements;
}

/**
 * Generate Word document from HTML content (sermon editor)
 */
export async function generateWordDocumentFromHtml(
  html: string,
  _options: ExportOptions = {}
): Promise<Buffer> {
  if (!html || typeof html !== 'string') {
    throw new Error('Invalid html parameter: expected non-empty string');
  }

  const elements = parseHtmlToElementsWithFormatting(html);
  const paragraphs: Paragraph[] = [];

  // Helper to convert runs to TextRun array
  const runsToTextRuns = (runs: FormattedTextRun[], baseSize: number = 22): TextRun[] => {
    return runs.map(run => new TextRun({
      text: run.text,
      size: baseSize,
      bold: run.bold,
      italics: run.italic,
      underline: run.underline ? {} : undefined,
    }));
  };

  // Helper to convert alignment string to docx AlignmentType
  const getAlignment = (align?: 'left' | 'center' | 'right'): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined => {
    switch (align) {
      case 'center': return AlignmentType.CENTER;
      case 'right': return AlignmentType.RIGHT;
      case 'left': return AlignmentType.LEFT;
      default: return undefined;
    }
  };

  // Convert parsed elements to docx paragraphs (no metadata header for sermon exports)
  for (const el of elements) {
    if (el.type === 'hr') {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '─'.repeat(50),
              color: 'CCCCCC',
            }),
          ],
          spacing: { before: 200, after: 200 },
          alignment: AlignmentType.CENTER,
        })
      );
      continue;
    }

    if (el.type === 'heading') {
      const headingLevel = el.level === 1 ? HeadingLevel.HEADING_1 
        : el.level === 2 ? HeadingLevel.HEADING_2 
        : HeadingLevel.HEADING_3;
      
      paragraphs.push(
        new Paragraph({
          children: runsToTextRuns(el.runs, el.level === 1 ? 32 : el.level === 2 ? 28 : 24),
          heading: headingLevel,
          alignment: getAlignment(el.alignment),
          spacing: { before: 300, after: 150 },
        })
      );
      continue;
    }

    if (el.type === 'blockquote') {
      paragraphs.push(
        new Paragraph({
          children: el.runs.map(run => new TextRun({
            text: run.text,
            italics: true,
            color: '555555',
          })),
          indent: { left: 720 }, // 0.5 inch
          alignment: getAlignment(el.alignment),
          spacing: { before: 150, after: 150 },
        })
      );
      continue;
    }

    // Regular paragraph - preserve formatting and alignment from runs
    paragraphs.push(
      new Paragraph({
        children: runsToTextRuns(el.runs),
        alignment: getAlignment(el.alignment),
        spacing: { after: 200 },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Generate PDF document from HTML content (sermon editor)
 */
export async function generatePdfDocumentFromHtml(
  html: string,
  _options: ExportOptions = {}
): Promise<Buffer> {
  if (!html || typeof html !== 'string') {
    throw new Error('Invalid html parameter: expected non-empty string');
  }

  const elements = parseHtmlToElementsWithFormatting(html);
  
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const checkNewPage = (neededHeight: number = 20) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Helper to render text runs with inline formatting
  const renderFormattedText = (runs: FormattedTextRun[], x: number, maxWidth: number, fontSize: number = 11): number => {
    // For PDF, we need to render each run separately since jsPDF doesn't support mixed inline styles
    // First, concatenate all text to calculate total height needed
    const fullText = runs.map(r => r.text).join('');
    const splitLines = doc.splitTextToSize(fullText, maxWidth);
    const lineHeight = fontSize * 0.4;
    const totalHeight = splitLines.length * lineHeight;
    
    checkNewPage(totalHeight);
    
    // Now render each run - simplified approach: render line by line
    // For each line, find which runs contribute to it
    let currentX = x;
    let currentY = y;
    let charIndex = 0;
    
    for (const line of splitLines) {
      currentX = x;
      let lineCharCount = 0;
      let runIndex = 0;
      let runCharOffset = 0;
      
      // Find starting run for this line based on charIndex
      let totalChars = 0;
      for (let i = 0; i < runs.length; i++) {
        const currentRun = runs[i];
        if (currentRun && totalChars + currentRun.text.length > charIndex) {
          runIndex = i;
          runCharOffset = charIndex - totalChars;
          break;
        }
        if (currentRun) {
          totalChars += currentRun.text.length;
        }
      }
      
      // Render characters from runs until we've rendered this line
      while (lineCharCount < line.length && runIndex < runs.length) {
        const run = runs[runIndex];
        if (!run) break;
        
        const remainingInRun = run.text.length - runCharOffset;
        const charsToRender = Math.min(remainingInRun, line.length - lineCharCount);
        const textSegment = run.text.substring(runCharOffset, runCharOffset + charsToRender);
        
        // Set font style based on run formatting
        const fontStyle = run.bold && run.italic ? 'bolditalic' 
          : run.bold ? 'bold' 
          : run.italic ? 'italic' 
          : 'normal';
        
        doc.setFont('helvetica', fontStyle);
        doc.setFontSize(fontSize);
        doc.text(textSegment, currentX, currentY);
        currentX += doc.getTextWidth(textSegment);
        
        lineCharCount += charsToRender;
        runCharOffset += charsToRender;
        
        if (runCharOffset >= run.text.length) {
          runIndex++;
          runCharOffset = 0;
        }
      }
      
      charIndex += line.length;
      // Skip space between words that got split
      if (charIndex < fullText.length && fullText[charIndex] === ' ') {
        charIndex++;
      }
      currentY += lineHeight;
    }
    
    return totalHeight;
  };

  // Process elements (no metadata header for sermon exports)
  for (const el of elements) {
    checkNewPage();

    if (el.type === 'hr') {
      doc.setDrawColor(200);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;
      continue;
    }

    if (el.type === 'heading') {
      const fontSize = el.level === 1 ? 18 : el.level === 2 ? 14 : 12;
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      
      const text = el.runs.map(r => r.text).join('');
      const splitText = doc.splitTextToSize(text, contentWidth);
      checkNewPage(splitText.length * fontSize * 0.5);
      
      // Apply alignment for headings
      const headingAlign = el.alignment === 'center' ? 'center' 
        : el.alignment === 'right' ? 'right' : undefined;
      if (headingAlign) {
        doc.text(splitText, headingAlign === 'center' ? pageWidth / 2 : pageWidth - margin, y, { align: headingAlign });
      } else {
        doc.text(splitText, margin, y);
      }
      y += splitText.length * fontSize * 0.5 + 8;
      continue;
    }

    if (el.type === 'blockquote') {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(80);
      
      const text = el.runs.map(r => r.text).join('');
      const splitText = doc.splitTextToSize(text, contentWidth - 20);
      checkNewPage(splitText.length * 5);
      doc.text(splitText, margin + 10, y);
      y += splitText.length * 5 + 8;
      doc.setTextColor(0);
      continue;
    }

    // Regular paragraph with inline formatting
    doc.setTextColor(0);
    
    // For centered paragraphs, use simpler rendering
    if (el.alignment === 'center') {
      const text = el.runs.map(r => r.text).join('');
      const splitText = doc.splitTextToSize(text, contentWidth);
      checkNewPage(splitText.length * 5);
      
      // Apply formatting from first run for the whole paragraph (simplified)
      const firstRun = el.runs[0];
      const fontStyle = firstRun?.bold && firstRun?.italic ? 'bolditalic'
        : firstRun?.bold ? 'bold'
        : firstRun?.italic ? 'italic'
        : 'normal';
      doc.setFont('helvetica', fontStyle);
      doc.setFontSize(11);
      doc.text(splitText, pageWidth / 2, y, { align: 'center' });
      y += splitText.length * 5 + 5;
    } else {
      const height = renderFormattedText(el.runs, margin, contentWidth, 11);
      y += height + 5;
    }
  }

  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Markdown from HTML content (sermon editor)
 */
export function generateMarkdownFromHtml(html: string, _options: ExportOptions = {}): string {
  // No metadata header - just convert HTML to Markdown directly
  return htmlToMarkdown(html);
}
