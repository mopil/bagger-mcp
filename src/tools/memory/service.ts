interface MemoryServiceOptions {
  token: string;
}

const MEMORY_SPACE_REPO = "mopil/memory-space";
const MEMORY_SPACE_BRANCH = "main";

export interface MemoryEntry {
  [key: string]: unknown;
  name: string;
  path: string;
  type: "file" | "dir";
  sha: string;
  size: number;
}

export interface MemoryFile {
  [key: string]: unknown;
  path: string;
  content: string;
  sha: string;
  size: number;
}

export interface MemoryWriteResult {
  [key: string]: unknown;
  path: string;
  sha: string;
  created: boolean;
  commit: { sha: string; url: string };
}

export interface MemoryDeleteResult {
  [key: string]: unknown;
  path: string;
  commit: { sha: string; url: string };
}

export interface MemorySearchItem {
  path: string;
  name: string;
  sha: string;
  url: string;
  snippet?: string;
}

export interface MemorySearchResult {
  [key: string]: unknown;
  total_count: number;
  items: MemorySearchItem[];
}

export interface MemoryBulkWriteResult {
  [key: string]: unknown;
  written: Array<{ path: string }>;
  commit: { sha: string; url: string };
}

export interface MemoryBulkDeleteResult {
  [key: string]: unknown;
  deleted: string[];
  commit: { sha: string; url: string };
}

export interface MemoryBulkCommitResult {
  [key: string]: unknown;
  written: Array<{ path: string }>;
  deleted: string[];
  commit: { sha: string; url: string };
}

const GITHUB_API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;

export class MemoryService {
  private readonly repo = MEMORY_SPACE_REPO;
  private readonly branch = MEMORY_SPACE_BRANCH;
  private readonly token: string;

  constructor(options: MemoryServiceOptions) {
    this.token = options.token;
  }

  async list(path?: string): Promise<MemoryEntry[]> {
    const data = await this.githubFetch<GithubContentsResponse>(
      "GET",
      this.contentsUrl(path ?? ""),
    );

    if (Array.isArray(data)) {
      return data.map(toMemoryEntry);
    }

    throw new Error(
      `Path refers to a file, not a directory: ${path ?? "/"}. Use memory_read instead.`,
    );
  }

  async read(path: string): Promise<MemoryFile> {
    const data = await this.githubFetch<GithubFileResponse>(
      "GET",
      this.contentsUrl(path),
    );

    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`Path is not a file: ${path}`);
    }

    const encoding = data.encoding ?? "base64";
    if (encoding !== "base64") {
      throw new Error(`Unsupported encoding for ${path}: ${encoding}`);
    }

    const content = Buffer.from(data.content ?? "", "base64").toString("utf8");

    return {
      path: data.path,
      content,
      sha: data.sha,
      size: data.size,
    };
  }

  async write(
    path: string,
    content: string,
    commitMessage: string,
  ): Promise<MemoryWriteResult> {
    const existingSha = await this.tryGetSha(path);
    const body: Record<string, unknown> = {
      message: commitMessage,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: this.branch,
    };
    if (existingSha) {
      body.sha = existingSha;
    }

    const data = await this.githubFetch<GithubWriteResponse>(
      "PUT",
      this.contentsUrl(path, { includeRef: false }),
      body,
    );

    return {
      path: data.content.path,
      sha: data.content.sha,
      created: !existingSha,
      commit: { sha: data.commit.sha, url: data.commit.html_url },
    };
  }

  async delete(path: string, commitMessage: string): Promise<MemoryDeleteResult> {
    const sha = await this.tryGetSha(path);
    if (!sha) {
      throw new Error(`Cannot delete: ${path} does not exist on ${this.branch}.`);
    }

    const data = await this.githubFetch<GithubWriteResponse>(
      "DELETE",
      this.contentsUrl(path, { includeRef: false }),
      {
        message: commitMessage,
        branch: this.branch,
        sha,
      },
    );

    return {
      path,
      commit: { sha: data.commit.sha, url: data.commit.html_url },
    };
  }

  async search(
    query: string,
    options: { extension?: string; path?: string } = {},
  ): Promise<MemorySearchResult> {
    const qualifiers = [`repo:${this.repo}`];
    if (options.extension) {
      qualifiers.push(`extension:${options.extension.replace(/^\./, "")}`);
    }
    if (options.path) {
      qualifiers.push(`path:${options.path}`);
    }
    const q = [query, ...qualifiers].join(" ");
    const url = `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(q)}&per_page=30`;

    const data = await this.githubFetch<GithubSearchResponse>("GET", url, undefined, {
      accept: "application/vnd.github.text-match+json",
    });

    return {
      total_count: data.total_count,
      items: data.items.map((item) => ({
        path: item.path,
        name: item.name,
        sha: item.sha,
        url: item.html_url,
        snippet: item.text_matches?.[0]?.fragment,
      })),
    };
  }

  async bulkWrite(
    writes: Array<{ path: string; content: string }>,
    commitMessage: string,
  ): Promise<MemoryBulkWriteResult> {
    for (const write of writes) {
      validatePathSegments(write.path);
    }
    const tree = await Promise.all(
      writes.map(async (write) => {
        const blob = await this.githubFetch<{ sha: string }>(
          "POST",
          `${GITHUB_API_BASE}/repos/${this.repo}/git/blobs`,
          {
            content: Buffer.from(write.content, "utf8").toString("base64"),
            encoding: "base64",
          },
        );
        return {
          path: normalizeRepoPath(write.path),
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      }),
    );

    const commit = await this.applyTreeAsCommit(tree, commitMessage);
    return {
      written: writes.map((w) => ({ path: normalizeRepoPath(w.path) })),
      commit,
    };
  }

  async bulkCommit(
    writes: Array<{ path: string; content: string }>,
    deletes: string[],
    commitMessage: string,
  ): Promise<MemoryBulkCommitResult> {
    if (writes.length === 0 && deletes.length === 0) {
      throw new Error("bulkCommit requires at least one write or delete.");
    }
    for (const write of writes) {
      validatePathSegments(write.path);
    }
    for (const path of deletes) {
      validatePathSegments(path);
    }

    if (deletes.length > 0) {
      const existence = await Promise.all(
        deletes.map(async (path) => ({ path, sha: await this.tryGetSha(path) })),
      );
      const missing = existence.filter((entry) => entry.sha === undefined).map((e) => e.path);
      if (missing.length > 0) {
        throw new Error(
          `Cannot commit: ${missing.length} delete path(s) do not exist on ${this.branch}: ${missing.join(", ")}`,
        );
      }
    }

    const writeEntries = await Promise.all(
      writes.map(async (write) => {
        const blob = await this.githubFetch<{ sha: string }>(
          "POST",
          `${GITHUB_API_BASE}/repos/${this.repo}/git/blobs`,
          {
            content: Buffer.from(write.content, "utf8").toString("base64"),
            encoding: "base64",
          },
        );
        return {
          path: normalizeRepoPath(write.path),
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      }),
    );

    const deleteEntries = deletes.map((path) => ({
      path: normalizeRepoPath(path),
      mode: "100644" as const,
      type: "blob" as const,
      sha: null,
    }));

    const commit = await this.applyTreeAsCommit(
      [...writeEntries, ...deleteEntries],
      commitMessage,
    );
    return {
      written: writes.map((w) => ({ path: normalizeRepoPath(w.path) })),
      deleted: deletes.map(normalizeRepoPath),
      commit,
    };
  }

  async bulkDelete(paths: string[], commitMessage: string): Promise<MemoryBulkDeleteResult> {
    for (const path of paths) {
      validatePathSegments(path);
    }

    const existence = await Promise.all(
      paths.map(async (path) => ({ path, sha: await this.tryGetSha(path) })),
    );
    const missing = existence.filter((entry) => entry.sha === undefined).map((e) => e.path);
    if (missing.length > 0) {
      throw new Error(
        `Cannot bulk_delete: ${missing.length} path(s) do not exist on ${this.branch}: ${missing.join(", ")}`,
      );
    }

    const tree = paths.map((path) => ({
      path: normalizeRepoPath(path),
      mode: "100644" as const,
      type: "blob" as const,
      sha: null,
    }));

    const commit = await this.applyTreeAsCommit(tree, commitMessage);
    return {
      deleted: paths.map(normalizeRepoPath),
      commit,
    };
  }

  private async applyTreeAsCommit(
    tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }>,
    commitMessage: string,
  ): Promise<{ sha: string; url: string }> {
    const refPath = `heads/${this.branch}`;
    const ref = await this.githubFetch<{ object: { sha: string } }>(
      "GET",
      `${GITHUB_API_BASE}/repos/${this.repo}/git/ref/${refPath}`,
    );
    const baseCommitSha = ref.object.sha;

    const baseCommit = await this.githubFetch<{ tree: { sha: string } }>(
      "GET",
      `${GITHUB_API_BASE}/repos/${this.repo}/git/commits/${baseCommitSha}`,
    );

    const newTree = await this.githubFetch<{ sha: string }>(
      "POST",
      `${GITHUB_API_BASE}/repos/${this.repo}/git/trees`,
      { base_tree: baseCommit.tree.sha, tree },
    );

    if (newTree.sha === baseCommit.tree.sha) {
      throw new Error(
        "Bulk operation produced no changes (target files already in that state). Aborting to avoid an empty commit.",
      );
    }

    const newCommit = await this.githubFetch<{ sha: string; html_url: string }>(
      "POST",
      `${GITHUB_API_BASE}/repos/${this.repo}/git/commits`,
      {
        message: commitMessage,
        tree: newTree.sha,
        parents: [baseCommitSha],
      },
    );

    await this.githubFetch<unknown>(
      "PATCH",
      `${GITHUB_API_BASE}/repos/${this.repo}/git/refs/${refPath}`,
      { sha: newCommit.sha },
    );

    return { sha: newCommit.sha, url: newCommit.html_url };
  }

  private async tryGetSha(path: string): Promise<string | undefined> {
    try {
      const data = await this.githubFetch<GithubFileResponse>(
        "GET",
        this.contentsUrl(path),
      );
      if (Array.isArray(data)) {
        throw new Error(`Path refers to a directory, not a file: ${path}`);
      }
      return data.sha;
    } catch (error) {
      if (error instanceof GithubApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private contentsUrl(path: string, options: { includeRef?: boolean } = {}): string {
    const includeRef = options.includeRef ?? true;
    const segments = validatePathSegments(path);
    const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
    const base = `${GITHUB_API_BASE}/repos/${this.repo}/contents${encoded ? `/${encoded}` : ""}`;
    return includeRef ? `${base}?ref=${encodeURIComponent(this.branch)}` : base;
  }

  private async githubFetch<T>(
    method: "GET" | "PUT" | "DELETE" | "POST" | "PATCH",
    url: string,
    body?: unknown,
    overrides: { accept?: string } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: overrides.accept ?? "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "x-github-api-version": "2022-11-28",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new GithubApiError(
          `GitHub API ${method} ${url} failed (${response.status}): ${errorText}`,
          response.status,
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`GitHub API request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class GithubApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "GithubApiError";
  }
}

type GithubContentsResponse = GithubFileResponse | GithubFileResponse[];

interface GithubFileResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir" | "symlink" | "submodule";
  encoding?: string;
  content?: string;
}

interface GithubWriteResponse {
  content: { path: string; sha: string };
  commit: { sha: string; html_url: string };
}

interface GithubSearchResponse {
  total_count: number;
  items: Array<{
    name: string;
    path: string;
    sha: string;
    html_url: string;
    text_matches?: Array<{ fragment?: string }>;
  }>;
}

function toMemoryEntry(item: GithubFileResponse): MemoryEntry {
  return {
    name: item.name,
    path: item.path,
    type: item.type === "dir" ? "dir" : "file",
    sha: item.sha,
    size: item.size,
  };
}

function validatePathSegments(path: string): string[] {
  const segments = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`Path must not contain '.' or '..' segments: ${path}`);
    }
  }
  return segments;
}

function normalizeRepoPath(path: string): string {
  return validatePathSegments(path).join("/");
}
