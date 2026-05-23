import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { readFile } from "node:fs/promises";
import { join as pjoin, extname as pextname, basename as pbasename, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  VFS_API_BASE,
  CLIENT_HEADER,
  mimeFromPath,
  type ServerInfo,
  type PathPairBody,
  type VfsEventMessage,
} from "@slideck/core";
import { DiskVfs } from "./disk-vfs";

// web ビルド成果物 (静的ファイル) の content-type。core の mimeFromPath は
// スライド素材向けで js/css/html を持たないため、ここで補う。
const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

// 自分の書き込みに由来するディスク監視イベントを、発生元クライアントへ
// 送り返さないための短命な記録。
const PENDING_TTL = 3000;
interface Pending {
  path: string;
  origin: string;
  at: number;
}

export interface ServeOptions {
  port?: number;
  host?: string;
  open?: boolean;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks)));
    req.on("error", rej);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

// 内部に DiskVfs + SSE + 静的配信を抱える HTTP サーバを構築する。
function build(root: string, webDir: string, name: string): Server {
  const vfs = new DiskVfs(root);
  const sse = new Set<ServerResponse>();
  let pending: Pending[] = [];

  const markPending = (path: string, origin: string | undefined): void => {
    if (origin) pending.push({ path, origin, at: Date.now() });
  };
  // イベントパスに対応する保留中の書き込みがあれば発生元を返す (サブツリー含む)。
  const originOf = (eventPath: string): string | undefined => {
    const now = Date.now();
    pending = pending.filter((p) => now - p.at < PENDING_TTL);
    const hit = pending.find(
      (p) => eventPath === p.path || eventPath.startsWith(p.path + "/"),
    );
    return hit?.origin;
  };

  // ディスク監視イベントを SSE で全クライアントへ配る (発生元タグ付き)。
  // watcher は create/update/delete のみ出すが、型の網羅のため move も拾う。
  vfs.subscribe((event) => {
    const path = "path" in event ? event.path : event.to;
    const msg: VfsEventMessage = { event, origin: originOf(path) };
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of sse) res.write(line);
  });

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    sub: string,
    url: URL,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const client = header(req, CLIENT_HEADER);
    const qpath = url.searchParams.get("path");

    if (sub === "/info" && method === "GET") {
      const info: ServerInfo = { server: true, name, root };
      return sendJson(res, 200, info);
    }
    if (sub === "/files" && method === "GET") {
      return sendJson(res, 200, await vfs.list());
    }
    if (sub === "/events" && method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      sse.add(res);
      req.on("close", () => sse.delete(res));
      return;
    }
    if (sub === "/stat" && method === "GET") {
      if (qpath === null) return sendJson(res, 400, { error: "path required" });
      return sendJson(res, 200, await vfs.stat(qpath));
    }
    if (sub === "/meta") {
      const key = url.searchParams.get("key");
      if (key === null) return sendJson(res, 400, { error: "key required" });
      if (method === "GET") {
        return sendJson(res, 200, { value: await vfs.getMeta(key) });
      }
      if (method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
          value: unknown;
        };
        await vfs.setMeta(key, body.value);
        res.writeHead(204).end();
        return;
      }
    }
    if (sub === "/file") {
      if (qpath === null) return sendJson(res, 400, { error: "path required" });
      if (method === "GET") {
        const bytes = await vfs.readBytes(qpath).catch(() => null);
        if (!bytes) return notFound(res);
        res.writeHead(200, { "content-type": mimeFromPath(qpath) });
        res.end(Buffer.from(bytes));
        return;
      }
      if (method === "PUT") {
        const body = await readBody(req);
        await vfs.writeBytes(qpath, new Uint8Array(body));
        markPending(qpath, client);
        res.writeHead(204).end();
        return;
      }
      if (method === "DELETE") {
        await vfs.delete(qpath);
        markPending(qpath, client);
        res.writeHead(204).end();
        return;
      }
    }
    if (sub === "/folder" && method === "POST") {
      if (qpath === null) return sendJson(res, 400, { error: "path required" });
      await vfs.createFolder(qpath);
      markPending(qpath, client);
      res.writeHead(204).end();
      return;
    }
    if (sub === "/move" && method === "POST") {
      const { from, to } = JSON.parse((await readBody(req)).toString("utf8")) as PathPairBody;
      await vfs.move(from, to);
      markPending(from, client);
      markPending(to, client);
      res.writeHead(204).end();
      return;
    }
    if (sub === "/copy" && method === "POST") {
      const { from, to } = JSON.parse((await readBody(req)).toString("utf8")) as PathPairBody;
      await vfs.copy(from, to);
      markPending(to, client);
      res.writeHead(204).end();
      return;
    }
    notFound(res);
  }

  // 静的ファイル配信。見つからず拡張子なしのパスは index.html を返す
  // (web は #ハッシュルーティングなので実体は常に "/")。
  async function handleStatic(res: ServerResponse, pathname: string): Promise<void> {
    const clean = decodeURIComponent(pathname).replace(/\.\.(\/|\\|$)/g, "");
    const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
    const file = pjoin(webDir, rel);
    const bytes = await readFile(file).catch(() => null);
    if (bytes) {
      const mime = STATIC_MIME[pextname(file).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(bytes);
      return;
    }
    if (pextname(clean) === "") {
      const html = await readFile(pjoin(webDir, "index.html")).catch(() => null);
      if (html) {
        res.writeHead(200, { "content-type": STATIC_MIME[".html"] });
        res.end(html);
        return;
      }
    }
    notFound(res);
  }

  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handle =
      url.pathname === VFS_API_BASE || url.pathname.startsWith(VFS_API_BASE + "/")
        ? handleApi(req, res, url.pathname.slice(VFS_API_BASE.length), url)
        : handleStatic(res, url.pathname);
    handle.catch((err: unknown) => {
      if (res.headersSent) return res.end();
      sendJson(res, 500, { error: String(err) });
    });
  });

  // SSE のアイドル切断を防ぐハートビート。
  const heartbeat = setInterval(() => {
    for (const res of sse) res.write(": ping\n\n");
  }, 25000);
  server.on("close", () => {
    clearInterval(heartbeat);
    vfs.dispose();
  });
  return server;
}

// 指定ポートから空きが見つかるまで listen する。
function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((res, rej) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && port < 65535) {
        server.listen(++port, host);
      } else {
        rej(err);
      }
    };
    server.on("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      res(port);
    });
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // ブラウザを開けなくても URL は出力済みなので無視。
  }
}

// プロジェクトディレクトリを編集サーバとして起動する。
export async function serve(root: string, webDir: string, opts: ServeOptions = {}): Promise<void> {
  const abs = resolve(root);
  const name = pbasename(abs) || "project";
  const host = opts.host ?? "localhost";
  const server = build(abs, webDir, name);
  const port = await listen(server, opts.port ?? 4321, host);
  const url = `http://${host}:${port}/`;

  console.log(`slideck serve: ${abs}`);
  console.log(`  ${url}`);
  if (opts.open !== false) openBrowser(url);

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
