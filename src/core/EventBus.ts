/** 通知するだけの側が受け取る型（より多くのイベントを持つ EventBus もそのまま渡せる）。 */
export interface EventSink<Events extends object> {
  emit<K extends keyof Events>(type: K, payload: Events[K]): void;
}

/**
 * 型付きの小さなイベント通知。系統間（物語状態・インタラクション・UI など）を
 * 直接参照させずにつなぐために使う。
 */
export class EventBus<Events extends object> implements EventSink<Events> {
  private readonly handlers = new Map<PropertyKey, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) (handler as (payload: Events[K]) => void)(payload);
  }
}
