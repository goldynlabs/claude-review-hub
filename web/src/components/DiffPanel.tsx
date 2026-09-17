import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { api } from "../lib/api";
import type { ChangedFile, SessionPr } from "../lib/types";
import { Empty } from "./ui/Empty";

const statusColor: Record<string, string> = {
  added: "text-severity-suggestion",
  deleted: "text-severity-critical",
  renamed: "text-severity-warning",
  modified: "text-muted-foreground",
};

export function DiffPanel({ pr }: { pr: SessionPr }) {
  const [selected, setSelected] = useState<string | null>(pr.files[0]?.file ?? null);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!selected) return;
    api.diff(pr.id, selected).then(setContent).catch((error: Error) => setContent(error.message));
  }, [pr.id, selected]);

  return (
    <div className="grid h-full grid-cols-[minmax(200px,280px)_1fr] gap-3 overflow-hidden">
      <div className="card overflow-y-auto p-1">
        <FileTree files={pr.files} selected={selected} onSelect={setSelected} />
        {!pr.files.length && <Empty variant="inline" title="No changed files loaded." />}
      </div>

      <div className="card overflow-auto p-3">
        <DiffBody markdown={content} />
      </div>
    </div>
  );
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file?: ChangedFile;
}

/** Paths come back flat; the panel is narrow, so they are folded into a tree. */
function buildTree(files: ChangedFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };

  for (const file of files) {
    const parts = file.file.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = node.children.find((item) => item.name === part && !item.file);
      if (!child || index === parts.length - 1) {
        child = { name: part, path, children: [] };
        node.children.push(child);
      }
      if (index === parts.length - 1) child.file = file;
      node = child;
    });
  }

  // A folder with a single sub-folder is written as one row (src/lib/api), the
  // way an editor's tree does it, so nesting never eats the whole width.
  const compact = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((node) => {
      let current = node;
      while (!current.file && current.children.length === 1 && !current.children[0].file) {
        const only = current.children[0];
        current = { ...only, name: `${current.name}/${only.name}` };
      }
      return { ...current, children: compact(current.children) };
    });

  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => ({ ...node, children: sort(node.children) }))
      .sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));

  return sort(compact(root.children));
}

function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: ChangedFile[];
  selected: string | null;
  onSelect: (file: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const rows = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${depth * 12 + 6}px` };

      if (node.file) {
        return (
          <button
            key={node.path}
            onClick={() => onSelect(node.file!.file)}
            style={indent}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded py-1 pr-2 text-left text-xs hover:bg-muted",
              selected === node.file.file && "bg-muted",
            )}
          >
            <span className={cn("truncate font-mono", statusColor[node.file.status] ?? "")} title={node.file.file}>
              {node.name}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="text-severity-suggestion">+{node.file.additions}</span>{" "}
              <span className="text-severity-critical">-{node.file.deletions}</span>
            </span>
          </button>
        );
      }

      const open = !collapsed.has(node.path);
      return (
        <div key={node.path}>
          <button
            onClick={() => toggle(node.path)}
            style={indent}
            className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            {open ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
            <span className="truncate font-mono" title={node.path}>
              {node.name}
            </span>
          </button>
          {open && rows(node.children, depth + 1)}
        </div>
      );
    });

  return <div>{rows(tree, 0)}</div>;
}

/** The per-file markdown the server wrote, rendered as a coloured diff. */
function DiffBody({ markdown }: { markdown: string }) {
  if (!markdown) return <Empty variant="inline" title="Select a file to see its diff." />;
  const lines = markdown.split("\n");
  return (
    <pre className="font-mono text-xs leading-[1.6]">
      {lines.map((line, index) => {
        if (line.startsWith("```")) return null;
        let tone = "";
        if (line.startsWith("+")) tone = "bg-severity-suggestion/10 text-severity-suggestion";
        else if (line.startsWith("-")) tone = "bg-severity-critical/10 text-severity-critical";
        else if (line.startsWith("**Lines")) tone = "mt-3 block font-sans font-medium text-muted-foreground";
        else if (line.startsWith("#")) tone = "block font-sans text-sm font-medium";
        return (
          <div key={index} className={cn("whitespace-pre-wrap px-1", tone)}>
            {line.replace(/\*\*/g, "")}
          </div>
        );
      })}
    </pre>
  );
}
