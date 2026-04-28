import { ReactNode } from "react";

type Block =
  | { type: "code"; language: string; value: string }
  | { type: "heading"; level: 1 | 2 | 3; value: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; value: string }
  | { type: "paragraph"; value: string };

export function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  if (!blocks.length) {
    return <p className="text-sm leading-7 text-gray-500">No response.</p>;
  }

  return (
    <div className="space-y-4 text-sm leading-7 text-gray-900">
      {blocks.map((block, index) => (
        <MarkdownBlock block={block} key={`${block.type}-${index}`} />
      ))}
    </div>
  );
}

function MarkdownBlock({ block }: { block: Block }) {
  if (block.type === "code") {
    return (
      <div className="overflow-hidden rounded-[1rem] border border-gray-200 bg-[#111]">
        {block.language ? (
          <div className="border-b border-white/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400">
            {block.language}
          </div>
        ) : null}
        <pre className="thin-scrollbar max-h-96 overflow-auto p-3 text-xs leading-6 text-gray-100">
          <code>{block.value}</code>
        </pre>
      </div>
    );
  }

  if (block.type === "heading") {
    const className = "font-semibold tracking-[-0.01em] text-gray-950";
    if (block.level === 1) {
      return <h2 className={`${className} text-xl`}>{renderInlineMarkdown(block.value)}</h2>;
    }
    if (block.level === 2) {
      return <h3 className={`${className} text-lg`}>{renderInlineMarkdown(block.value)}</h3>;
    }
    return <h4 className={`${className} text-base`}>{renderInlineMarkdown(block.value)}</h4>;
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === "quote") {
    return (
      <blockquote className="border-l-2 border-gray-300 pl-4 text-gray-600">
        {renderInlineMarkdown(block.value)}
      </blockquote>
    );
  }

  return <p>{renderInlineMarkdown(block.value)}</p>;
}

function parseMarkdownBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const language = fence[1] || "";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language, value: code.join("\n") });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, value: heading[2] });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = ordered ? current.match(/^\d+\.\s+(.+)$/) : current.match(/^[-*]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", value: quote.join(" ") });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        current.startsWith("```") ||
        /^(#{1,3})\s+/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current) ||
        current.startsWith(">")
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", value: paragraph.join(" ") });
  }

  return blocks;
}

function renderInlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(
        <code className="rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[0.85em] text-gray-900" key={nodes.length}>
          {match[2]}
        </code>
      );
    } else if (match[3]) {
      nodes.push(<strong key={nodes.length}>{match[3]}</strong>);
    } else if (match[4]) {
      nodes.push(<em key={nodes.length}>{match[4]}</em>);
    } else if (match[5] && match[6]) {
      nodes.push(
        <a
          className="font-medium text-gray-950 underline decoration-gray-300 underline-offset-4 transition hover:decoration-gray-900"
          href={safeHref(match[6])}
          key={nodes.length}
          rel="noreferrer"
          target="_blank"
        >
          {match[5]}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes;
}

function safeHref(href: string) {
  return /^(https?:|mailto:)/i.test(href) ? href : "#";
}
