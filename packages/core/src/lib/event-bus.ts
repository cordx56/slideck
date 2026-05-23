import type { VFSEvent, VFSListener } from "../vfs";

// VFS 実装が変更通知を配るための最小イベントバス。web (IndexedDB) と
// cli (disk) の双方が利用する。
export class EventBus {
  private listeners = new Set<VFSListener>();

  subscribe(listener: VFSListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: VFSEvent): void {
    for (const l of this.listeners) l(event);
  }
}
