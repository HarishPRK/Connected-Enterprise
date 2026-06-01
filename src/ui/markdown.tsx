/**
 * Tiny, dependency-free renderer for the lightweight markdown the LLM tends to
 * emit inside thought / diagnosis / resolution / proposal blocks:
 *   - **bold** and *italic* and `inline code`
 *   - paragraphs (split on blank lines)
 *   - bullet lists (-, *, • prefix)
 *   - numbered lists (1. prefix)
 *
 * Not a full markdown parser. Just enough to make Claude's outputs read clean.
 */
import { Fragment, type ReactNode } from 'react';

export function RichText({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((block, i) => <Block key={i} block={block} />)}
    </>
  );
}

type UlBlock   = { kind: 'ul'; items: string[] };
type OlBlock   = { kind: 'ol'; items: string[] };
type ParaBlock = { kind: 'p';  text: string };
type RichBlock = UlBlock | OlBlock | ParaBlock;

function splitBlocks(text: string): RichBlock[] {
  // Split on blank-line boundaries, then classify each block.
  const blocks: RichBlock[] = [];
  const paragraphs = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

  for (const para of paragraphs) {
    const lines = para.split('\n').map((l) => l.replace(/\s+$/, ''));

    // Check for a homogeneous list block.
    const isBullet = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    if (isBullet && lines.length >= 1) {
      blocks.push({ kind: 'ul', items: lines.map((l) => l.replace(/^\s*[-*•]\s+/, '')) });
      continue;
    }
    const isNumbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
    if (isNumbered && lines.length >= 1) {
      blocks.push({ kind: 'ol', items: lines.map((l) => l.replace(/^\s*\d+[.)]\s+/, '')) });
      continue;
    }

    // Otherwise treat as a paragraph (preserve internal single line breaks as <br>).
    blocks.push({ kind: 'p', text: para });
  }

  return blocks;
}

function Block({ block }: { block: RichBlock }) {
  if (block.kind === 'ul') {
    return (
      <ul className="rt-ul">
        {block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}
      </ul>
    );
  }
  if (block.kind === 'ol') {
    return (
      <ol className="rt-ol">
        {block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}
      </ol>
    );
  }
  // Paragraph — split on single newlines into <br>-separated runs
  const lines: string[] = block.text.split('\n');
  return (
    <p className="rt-p">
      {lines.map((line: string, i: number) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Inline text={line} />
        </Fragment>
      ))}
    </p>
  );
}

/** Inline tokens: **bold**, *italic*, `code`. Order matters — bold first. */
function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  // Single regex with alternation captures all three styles at once.
  // Group 1: **bold**  Group 2: *italic*  Group 3: `code`
  const re = /\*\*([^*\n]+?)\*\*|(?<![*\w])\*([^*\n]+?)\*(?!\w)|`([^`\n]+?)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined)      out.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em     key={key++}>{m[2]}</em>);
    else if (m[3] !== undefined) out.push(<code   key={key++}>{m[3]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
