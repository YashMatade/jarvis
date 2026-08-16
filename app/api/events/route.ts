import { NextRequest } from "next/server";
import { subscribeEvents } from "@/lib/events";
import { startScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE endpoint: the browser keeps this connection open and receives
// proactive events (reminders, system alerts) as they fire. Starting the
// scheduler here guarantees it runs exactly once per server process, on
// the first client that connects.
export async function GET(req: NextRequest) {
  // Make sure the scheduling loop is running.
  startScheduler();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send a hello comment immediately so the browser knows the
      // connection is alive.
      controller.enqueue(encoder.encode(": connected\n\n"));
      const unsubscribe = subscribeEvents(controller);

      const cleanup = () => {
        unsubscribe();
      };

      req.signal.addEventListener("abort", cleanup);
      // If the request aborts or disconnects, the stream cancel handler
      // fires, but we also subscribe to the request signal for safety.
    },
    cancel() {
      // Client went away.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
