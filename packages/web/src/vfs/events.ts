import type { VFSEvent, VFSListener } from "@slider/core";

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
