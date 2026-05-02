"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";

type FileEntry = {
  path: string;
  size: number;
  updatedAt: string;
};

type TreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  updatedAt?: string;
  children: Map<string, TreeNode>;
};

export function FilesBrowser({ initialFiles, embedded = false }: { initialFiles: FileEntry[]; embedded?: boolean }) {
  const [files, setFiles] = useState(initialFiles);
  const [selected, setSelected] = useState<string | null>(initialFiles[0]?.path || null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(initialFiles));
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const tree = useMemo(() => buildTree(files), [files]);
  const selectedFile = files.find((file) => file.path === selected);

  useEffect(() => {
    setFiles(initialFiles);
    setExpanded(defaultExpanded(initialFiles));
    setSelected((current) => {
      if (current && initialFiles.some((file) => file.path === current)) return current;
      return initialFiles[0]?.path || null;
    });
  }, [initialFiles]);

  useEffect(() => {
    if (!selected) {
      setContent("");
      return;
    }
    setLoading(true);
    fetch(`/api/files?path=${encodeURIComponent(selected)}`)
      .then((response) => response.json())
      .then((data) => setContent(data.content || ""))
      .finally(() => setLoading(false));
  }, [selected]);

  async function refresh() {
    const response = await fetch("/api/files");
    const data = await response.json();
    const nextFiles = data.files || [];
    setFiles(nextFiles);
    setExpanded(defaultExpanded(nextFiles));
    if (!selected && nextFiles[0]) setSelected(nextFiles[0].path);
  }

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const shellClass = embedded
    ? "motion-enter grid min-h-[62vh] gap-5 lg:grid-cols-[340px_minmax(0,1fr)]"
    : "motion-enter relative grid h-full min-h-0 w-full bg-white lg:grid-cols-[360px_minmax(0,1fr)]";
  const panelClass = embedded
    ? "flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm"
    : "hidden min-h-0 flex-col overflow-hidden border-b border-gray-200 bg-white lg:flex lg:border-b-0 lg:border-r";
  const previewClass = embedded
    ? "flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm"
    : "flex min-h-0 flex-col overflow-hidden bg-white";
  const treeScrollClass = embedded ? "max-h-[52vh]" : "flex-1";
  const codeScrollClass = embedded ? "max-h-[52vh]" : "flex-1";

  function renderTreePane(className: string, showClose = false) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Project</p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Files</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="grid h-10 w-10 place-items-center rounded-full border border-gray-200 text-gray-700 transition hover:border-gray-300"
              aria-label="Refresh files"
            >
              <Icon name="fa-rotate" />
            </button>
            {showClose ? (
              <button
                type="button"
                onClick={() => setMobileTreeOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full border border-gray-200 text-gray-700 transition hover:border-gray-300"
                aria-label="Close files"
              >
                <Icon name="fa-xmark" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2 rounded-2xl bg-gray-50 px-3 py-2 text-sm text-gray-500">
            <Icon name="fa-folder-tree" />
            <span className="truncate">{files.length} files in workspace repository</span>
          </div>
        </div>

        <div className={`thin-scrollbar min-h-0 overflow-auto p-3 ${treeScrollClass}`}>
          {files.length ? (
            <TreeList
              nodes={[...tree.children.values()]}
              expanded={expanded}
              selected={selected}
              onToggle={toggle}
              onSelect={(path) => {
                setSelected(path);
                setMobileTreeOpen(false);
              }}
              depth={0}
            />
          ) : (
            <p className="p-3 text-sm leading-7 text-gray-600">No files yet. Generate a plan from the agent.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className={shellClass}>
      {renderTreePane(panelClass)}

      <div className={previewClass}>
        <div className="flex flex-col justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Preview</p>
            <h2 className="mt-1 break-all text-xl font-semibold tracking-[-0.03em]">{selected || "No file selected"}</h2>
            {selectedFile ? (
              <p className="mt-2 text-sm text-gray-500">
                {formatBytes(selectedFile.size)} · updated {new Date(selectedFile.updatedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!embedded ? (
              <button
                type="button"
                onClick={() => setMobileTreeOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition hover:border-gray-300 lg:hidden"
              >
                <Icon name="fa-folder-tree" />
                Files
              </button>
            ) : null}
            {selected ? (
              <span className="w-fit rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600">
                {fileExtension(selected) || "file"}
              </span>
            ) : null}
          </div>
        </div>

        <div className={`thin-scrollbar min-h-0 overflow-auto bg-[#111] ${codeScrollClass}`}>
          {loading ? (
            <div className="p-5 text-sm text-gray-300">Loading...</div>
          ) : content ? (
            <CodeView content={content} />
          ) : (
            <div className="p-5 text-sm text-gray-300">Select a file.</div>
          )}
        </div>
      </div>

      {!embedded && mobileTreeOpen ? (
        <div className="absolute inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/10 backdrop-blur-[1px]" aria-label="Close files" onClick={() => setMobileTreeOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(88vw,340px)]">
            {renderTreePane("flex h-full min-h-0 flex-col overflow-hidden border-r border-gray-200 bg-white shadow-2xl shadow-black/15", true)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TreeList({
  nodes,
  expanded,
  selected,
  onToggle,
  onSelect,
  depth
}: {
  nodes: TreeNode[];
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="grid gap-1">
      {sorted.map((node) =>
        node.type === "directory" ? (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              className="flex h-9 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              <Icon name={expanded.has(node.path) ? "fa-chevron-down" : "fa-chevron-right"} className="w-3 text-[11px] text-gray-400" />
              <Icon name={expanded.has(node.path) ? "fa-folder-open" : "fa-folder"} className="text-gray-500" />
              <span className="truncate">{node.name}</span>
            </button>
            {expanded.has(node.path) ? (
              <TreeList
                nodes={[...node.children.values()]}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ) : null}
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            onClick={() => onSelect(node.path)}
            className={`flex min-h-9 w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition ${
              selected === node.path ? "bg-black text-white" : "text-gray-700 hover:bg-gray-50"
            }`}
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            <Icon name={iconForFile(node.name)} className={selected === node.path ? "text-white" : "text-gray-400"} />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {node.size !== undefined ? (
              <span className={`shrink-0 text-[11px] ${selected === node.path ? "text-gray-300" : "text-gray-400"}`}>
                {formatBytes(node.size)}
              </span>
            ) : null}
          </button>
        )
      )}
    </div>
  );
}

function CodeView({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="grid grid-cols-[auto_1fr] font-mono text-sm leading-6">
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className="contents">
          <span className="select-none border-r border-white/10 px-4 text-right text-gray-500">{index + 1}</span>
          <pre className="overflow-x-auto px-4 text-gray-100">{line || " "}</pre>
        </div>
      ))}
    </div>
  );
}

function buildTree(files: FileEntry[]) {
  const root: TreeNode = { name: "root", path: "", type: "directory", children: new Map() };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path,
          type: isFile ? "file" : "directory",
          children: new Map()
        });
      }
      const node = current.children.get(part)!;
      if (isFile) {
        node.type = "file";
        node.size = file.size;
        node.updatedAt = file.updatedAt;
      }
      current = node;
    });
  }

  return root;
}

function defaultExpanded(files: FileEntry[]) {
  const next = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      next.add(parts.slice(0, index).join("/"));
    }
  }
  return next;
}

function iconForFile(name: string) {
  if (name.endsWith(".tf")) return "fa-cube";
  if (name.endsWith(".py")) return "fa-brands fa-python";
  if (name.endsWith(".json")) return "fa-brands fa-js";
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "fa-file-lines";
  if (name.endsWith(".md")) return "fa-file-lines";
  return "fa-file-code";
}

function fileExtension(path: string) {
  const name = path.split("/").at(-1) || "";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return ext ? `.${ext}` : "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
