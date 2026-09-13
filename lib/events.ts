// Tiny in-process event bus used to push proactive events (reminders,
// system alerts) from the server to SSE-connected browser clients.
// This module is Node-only; never import it from client components.

export interface JarvisEvent {
  id?: string;
  type: "reminder" | "notification" | "system";
  title: string;
  body: string;
  reminderId?: number;
  ts: number;
}

type Client = {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

let clients = new Map<string, Client>();
let eventCounter = 0;

export function subscribeEvents(
  controller: ReadableStreamDefaultController<Uint8Array>,
): () => void {
  const id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  clients.set(id, { id, controller });

  // Send a heartbeat so the browser keeps the connection alive.
  const heartbeat = setInterval(() => {
    const payload = `: ping\n\n`;
    try {
      controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  return () => {
    clearInterval(heartbeat);
    clients.delete(id);
    try {
      controller.close();
    } catch {
      // Already closed.
    }
  };
}

export function emitEvent(event: JarvisEvent) {
  const full: JarvisEvent = {
    ...event,
    ts: event.ts || Date.now(),
  };
  const payload = `id: ${++eventCounter}\nevent: ${full.type}\ndata: ${JSON.stringify(full)}\n\n`;
  const bytes = new TextEncoder().encode(payload);

  for (const client of clients.values()) {
    try {
      client.controller.enqueue(bytes);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
