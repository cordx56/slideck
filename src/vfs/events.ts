export type VFSEvent =
  | { type: "create"; path: string }
  | { type: "update"; path: string }
  | { type: "delete"; path: string }
  | { type: "move"; from: string; to: string };

export type VFSListener = (event: VFSEvent) => void;

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
