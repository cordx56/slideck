import { watch, readdirSync, statSync, type FSWatcher, type Stats } from "node:fs";
import { join, relative, sep } from "node:path";
import type { VFSEvent } from "@slideck/core";

// ディスク上のプロジェクトを監視し、変更を VFSEvent 列で通知する。
// Linux では fs.watch の recursive が使えないため、ディレクトリ毎に watch を張り、
// 変更検知のたびに再走査してスナップショット差分でイベントを生成する。
// (典型的なスライドプロジェクトは小規模なので全走査で十分。)

interface Snap {
  kind: "file" | "folder";
  mtimeMs: number;
  size: number;
}

export interface Watcher {
  close(): void;
}

const DEBOUNCE_MS = 80;

export function createWatcher(
  root: string,
  ignore: (relPosix: string) => boolean,
  onEvents: (events: VFSEvent[]) => void,
): Watcher {
  const watchers = new Map<string, FSWatcher>(); // disk dir abs -> watcher
  let snapshot = new Map<string, Snap>(); // vfs path -> snap
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const toVfs = (abs: string): string => {
    const r = relative(root, abs).split(sep).join("/");
    return r === "" ? "/" : "/" + r;
  };

  function scan(): { snap: Map<string, Snap>; dirs: Set<string> } {
    const snap = new Map<string, Snap>();
    const dirs = new Set<string>([root]);
    const walk = (dir: string): void => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const abs = join(dir, name);
        const vfs = toVfs(abs);
        if (ignore(vfs.slice(1))) continue;
        let st: Stats;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          snap.set(vfs, { kind: "folder", mtimeMs: st.mtimeMs, size: 0 });
          dirs.add(abs);
          walk(abs);
        } else if (st.isFile()) {
          snap.set(vfs, { kind: "file", mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    };
    walk(root);
    return { snap, dirs };
  }

  function syncWatchers(dirs: Set<string>): void {
    for (const [dir, w] of watchers) {
      if (!dirs.has(dir)) {
        w.close();
        watchers.delete(dir);
      }
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      try {
        const w = watch(dir, () => schedule());
        w.on("error", () => {});
        watchers.set(dir, w);
      } catch {
        // ディレクトリが消えた直後など。次の再走査で整合する。
      }
    }
  }

  function diff(prev: Map<string, Snap>, next: Map<string, Snap>): VFSEvent[] {
    const events: VFSEvent[] = [];
    for (const [path, s] of next) {
      const p = prev.get(path);
      if (!p) events.push({ type: "create", path });
      else if (s.kind === "file" && (p.mtimeMs !== s.mtimeMs || p.size !== s.size))
        events.push({ type: "update", path });
    }
    for (const path of prev.keys()) {
      if (!next.has(path)) events.push({ type: "delete", path });
    }
    return events;
  }

  function rescan(): void {
    if (closed) return;
    const { snap, dirs } = scan();
    syncWatchers(dirs);
    const events = diff(snapshot, snap);
    snapshot = snap;
    if (events.length) onEvents(events);
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rescan, DEBOUNCE_MS);
  }

  // 初期スナップショットとウォッチャ設定 (イベントは出さない)。
  const init = scan();
  snapshot = init.snap;
  syncWatchers(init.dirs);

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const w of watchers.values()) w.close();
      watchers.clear();
    },
  };
}
