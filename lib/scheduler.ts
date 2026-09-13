// Proactive scheduler for Jarvis. Runs a lightweight tick loop that:
//   1. Fires due reminders (converted into notifications + SSE events)
//   2. Re-arms repeating reminders
//   3. Monitors system health and alerts on thresholds
//
// It is a server-side singleton started on first import. SSE clients
// subscribe via lib/events.ts. This module must only be imported from
// Node-only code (API routes), never from client components.

import {
  getDueReminders,
  markReminderTriggered,
  addReminder,
  addNotification,
  resetOverdueReminders,
} from "./memory";
import { getSystemHealth } from "./system";
import { emitEvent } from "./events";

const REMINDER_TICK_MS = 15_000;
const HEALTH_TICK_MS = 90_000;

// Thresholds for proactive health alerts.
const HEALTH_LIMITS = {
  cpuAlertPct: 95,
  ramAlertPct: 90,
  diskAlertPct: 90,
  batteryLowPct: 20,
};

let started = false;
let lastHealthCheckAt = 0;
let lastHealthStates: Record<string, boolean> = {};

function armRepeatingIfNeeded(
  reminderId: number,
  repeatMinutes: number | null,
) {
  if (!repeatMinutes || repeatMinutes <= 0) return;
  const base = new Date();
  base.setMinutes(base.getMinutes() + repeatMinutes);
  addReminder(
    `Repeated reminder #${reminderId}`,
    base.toISOString(),
    "repeat",
    repeatMinutes,
  );
}

async function checkReminders() {
  const due = getDueReminders(new Date().toISOString());
  for (const reminder of due) {
    if (reminder.status !== "pending") continue;
    markReminderTriggered(reminder.id);

    addNotification("Reminder", reminder.message, "reminder");
    emitEvent({
      type: "reminder",
      title: "Reminder",
      body: reminder.message,
      reminderId: reminder.id,
      ts: Date.now(),
    });

    if (reminder.repeat_minutes) {
      armRepeatingIfNeeded(reminder.id, reminder.repeat_minutes);
    }
  }
}

async function checkSystemHealth() {
  const now = Date.now();
  if (now - lastHealthCheckAt < HEALTH_TICK_MS) return;
  lastHealthCheckAt = now;

  try {
    const health = await getSystemHealth(true);
    const alerts: string[] = [];

    if (health.cpuPct >= HEALTH_LIMITS.cpuAlertPct && !lastHealthStates.cpu) {
      alerts.push(`CPU usage is at ${health.cpuPct}%`);
      lastHealthStates.cpu = true;
    } else if (health.cpuPct < HEALTH_LIMITS.cpuAlertPct - 10) {
      lastHealthStates.cpu = false;
    }

    if (
      health.ramUsedPct >= HEALTH_LIMITS.ramAlertPct &&
      !lastHealthStates.ram
    ) {
      alerts.push(`Memory usage is at ${health.ramUsedPct}%`);
      lastHealthStates.ram = true;
    } else if (health.ramUsedPct < HEALTH_LIMITS.ramAlertPct - 10) {
      lastHealthStates.ram = false;
    }

    if (
      health.diskUsedPct >= HEALTH_LIMITS.diskAlertPct &&
      !lastHealthStates.disk
    ) {
      alerts.push(`Disk usage is at ${health.diskUsedPct}%`);
      lastHealthStates.disk = true;
    } else if (health.diskUsedPct < HEALTH_LIMITS.diskAlertPct - 10) {
      lastHealthStates.disk = false;
    }

    if (
      health.batteryPct !== undefined &&
      health.batteryPct <= HEALTH_LIMITS.batteryLowPct &&
      !health.batteryCharging &&
      !lastHealthStates.battery
    ) {
      alerts.push(`Battery is at ${health.batteryPct}%`);
      lastHealthStates.battery = true;
    } else if (
      health.batteryPct !== undefined &&
      (health.batteryPct > HEALTH_LIMITS.batteryLowPct + 5 ||
        health.batteryCharging)
    ) {
      lastHealthStates.battery = false;
    }

    if (alerts.length > 0) {
      const body = alerts.join(". ");
      addNotification("System Alert", body, "system");
      emitEvent({
        type: "notification",
        title: "System Alert",
        body,
        ts: Date.now(),
      });
    }
  } catch {
    // Health monitoring is best-effort; never crash the tick loop.
  }
}

export function startScheduler() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      // Anything older than 10 minutes was fire-and-forget while no client
      // was connected; mark it missed instead of spamming.
      resetOverdueReminders(10);
      await checkReminders();
      await checkSystemHealth();
    } catch {
      // Scheduler must never throw unhandled.
    }
  };

  void tick();
  const reminderTimer = setInterval(
    () => void checkReminders(),
    REMINDER_TICK_MS,
  );
  const healthTimer = setInterval(
    () => void checkSystemHealth(),
    HEALTH_TICK_MS,
  );

  // Don't hold the process open — the Next.js server already does.
  reminderTimer.unref?.();
  healthTimer.unref?.();
}
