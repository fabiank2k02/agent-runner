export function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function quoteRemotePath(path: string): string {
  if (path === "~") {
    return "$HOME";
  }
  if (path.startsWith("~/")) {
    return `$HOME/${path
      .slice(2)
      .split("/")
      .filter(Boolean)
      .map(shellQuote)
      .join("/")}`;
  }
  return shellQuote(path);
}

export function joinRemotePath(...parts: string[]): string {
  const cleaned = parts.filter(Boolean);
  if (cleaned.length === 0) {
    return ".";
  }

  return cleaned.reduce((left, right) => {
    const lhs = left.replace(/\/+$/u, "");
    const rhs = right.replace(/^\/+/u, "");
    if (lhs === "" || lhs === "~") {
      return `${lhs}/${rhs}`;
    }
    return `${lhs}/${rhs}`;
  });
}

export function dirnameRemote(path: string): string {
  const normalized = path.replace(/\/+$/u, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return ".";
  }
  return normalized.slice(0, index);
}
