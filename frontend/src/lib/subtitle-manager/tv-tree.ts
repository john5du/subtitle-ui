import type { DirectoryScanResult, ScanDirectory, TreeNode, VisibleTreeNode } from "@/lib/types";

export function normalizeForCompare(pathValue: string | undefined | null) {
  return String(pathValue ?? "")
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function basenamePath(pathValue: string | undefined | null) {
  const cleaned = String(pathValue ?? "").replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) {
    return cleaned || "Root";
  }
  return parts[parts.length - 1];
}

export function joinPath(base: string, segment: string) {
  if (!base) {
    return segment;
  }

  const useBackslash = base.includes("\\");
  const separator = useBackslash ? "\\" : "/";
  if (base.endsWith("\\") || base.endsWith("/")) {
    return `${base}${segment}`;
  }
  return `${base}${separator}${segment}`;
}

export function deriveTreeRootPath(entries: ScanDirectory[], configuredRoot: string) {
  const preferred = String(configuredRoot || "").trim();
  if (preferred) {
    return preferred;
  }
  if (entries.length === 0) {
    return "";
  }

  const normalized = entries.map((entry) => normalizeForCompare(entry.path)).filter(Boolean);
  if (normalized.length === 0) {
    return String(entries[0]?.path || "").trim();
  }

  let prefix = normalized[0];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    let nextLength = Math.min(prefix.length, current.length);
    while (nextLength > 0 && prefix.slice(0, nextLength) !== current.slice(0, nextLength)) {
      nextLength -= 1;
    }
    prefix = prefix.slice(0, nextLength);
    if (!prefix) {
      break;
    }
  }

  const slashIndex = prefix.lastIndexOf("/");
  const trimmed = slashIndex >= 0 ? prefix.slice(0, slashIndex) : prefix;
  if (!trimmed) {
    return String(entries[0]?.path || "").trim();
  }

  const useBackslash = String(entries[0]?.path || "").includes("\\");
  return trimmed.replace(/\//g, useBackslash ? "\\" : "/");
}

export function pickDefaultTvDirectory(scan: DirectoryScanResult) {
  const root = String(scan.tvRoot || "").trim() || String(scan.tv?.[0]?.path || "").trim();
  if (root) {
    return root;
  }
  return scan.tv?.[0]?.path || "";
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => a.label.localeCompare(b.label));
  for (const child of node.children) {
    sortTree(child);
  }
}

export function buildDirectoryTree(entries: ScanDirectory[], rootPath: string, fallbackLabel: string): TreeNode {
  const root: TreeNode = {
    path: rootPath || "",
    label: basenamePath(rootPath || "") || fallbackLabel,
    videoCount: 0,
    metadataCount: 0,
    children: []
  };

  const index = new Map<string, TreeNode>();
  index.set(root.path || "__ROOT__", root);

  const rootNorm = normalizeForCompare(rootPath);
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const item of sorted) {
    const fullPath = item.path;
    const fullNorm = normalizeForCompare(fullPath);

    let relative = "";
    if (rootNorm && fullNorm.startsWith(rootNorm)) {
      relative = fullPath.slice(rootPath.length).replace(/^[\\/]+/, "");
    } else {
      relative = fullPath;
    }

    const segments = String(relative).split(/[\\/]+/).filter(Boolean);
    let current = root;
    let currentPath = root.path;

    if (segments.length === 0) {
      current.videoCount += item.videoFileCount || 0;
      current.metadataCount += item.metadataFileCount || 0;
      continue;
    }

    for (const segment of segments) {
      const childPath = joinPath(currentPath, segment);
      let child = index.get(childPath);
      if (!child) {
        child = {
          path: childPath,
          label: segment,
          videoCount: 0,
          metadataCount: 0,
          children: []
        };
        index.set(childPath, child);
        current.children.push(child);
      }
      current = child;
      currentPath = childPath;
    }

    current.videoCount += item.videoFileCount || 0;
    current.metadataCount += item.metadataFileCount || 0;
  }

  sortTree(root);
  return root;
}

export function flattenTree(
  node: TreeNode,
  depth: number,
  out: VisibleTreeNode[],
  isExpanded: (path: string) => boolean
) {
  const expanded = depth === 0 ? true : isExpanded(node.path);
  out.push({
    path: node.path,
    label: depth === 0 ? node.label || "" : node.label,
    depth,
    hasChildren: node.children.length > 0,
    videoCount: node.videoCount || 0,
    metadataCount: node.metadataCount || 0,
    expanded
  });

  if (!expanded) {
    return;
  }

  for (const child of node.children) {
    flattenTree(child, depth + 1, out, isExpanded);
  }
}

export function expandPathAncestorsMap(currentMap: Record<string, boolean>, rootPath: string, pathValue: string) {
  if (!rootPath || !pathValue) {
    return currentMap;
  }

  const rootNorm = normalizeForCompare(rootPath);
  const pathNorm = normalizeForCompare(pathValue);
  if (!pathNorm.startsWith(rootNorm)) {
    return currentMap;
  }

  const relative = pathNorm.slice(rootNorm.length).replace(/^\/+/, "");
  const next: Record<string, boolean> = { ...currentMap, [rootPath]: true };

  let current = rootPath;
  for (const segment of relative.split("/").filter(Boolean)) {
    current = joinPath(current, segment);
    next[current] = true;
  }

  return next;
}
