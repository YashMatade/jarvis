// macOS integration layer for Nexus. Executes native AppleScript commands via
// `osascript` to control Calendar, Reminders, Music, Notifications, volume,
// and other system features. All functions return plain strings suitable for
// tool results — failures are returned as text, never thrown.

import { exec as execCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const exec = promisify(execCb);

function isMac(): boolean {
  return process.platform === "darwin";
}

async function runAppleScript(script: string): Promise<string> {
  if (!isMac()) {
    return "macOS integration unavailable: this tool only works on macOS.";
  }
  // Write the script to a temp file and run `osascript <file>`. This is far
  // more robust than `osascript -e` because it avoids shell-quoting hell with
  // multi-line scripts that embed their own quotes.
  const tmpFile = path.join(
    os.tmpdir(),
    `nexus-osascript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.scpt`,
  );
  try {
    await fs.writeFile(tmpFile, script, "utf-8");
    const { stdout, stderr } = await exec(`osascript "${tmpFile}"`, {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() || stderr.trim() || "(done)";
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // The user may have denied automation permission. Make that actionable.
    if (/not authorized|not allowed|osascript.*error/i.test(message)) {
      return `macOS blocked this command. Grant automation permission in System Settings → Privacy & Security → Automation, then try again. (${message.slice(0, 200)})`;
    }
    return `AppleScript failed: ${message.slice(0, 300)}`;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

// AppleScript date strings like: "Thursday, August 16, 2026 at 12:00:00 AM"
function dateStrForAppleScript(d: Date): string {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = d.getDate();
  const year = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const min = d.getMinutes().toString().padStart(2, "0");
  const sec = d.getSeconds().toString().padStart(2, "0");
  return `${weekday}, ${month} ${day}, ${year} at ${h}:${min}:${sec} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/**
 * Create a calendar event on macOS Calendar.app.
 * `startDate` should be a JS Date-compatible ISO string.
 */
export async function createCalendarEvent(options: {
  title: string;
  startDate: string;
  endDate?: string;
  location?: string;
  calendar?: string;
}) {
  const title = options.title.replace(/"/g, '\\"');
  const location = (options.location || "").replace(/"/g, '\\"');
  const calendar = (options.calendar || "Calendar").replace(/"/g, '\\"');

  const start = new Date(options.startDate);
  const end = options.endDate
    ? new Date(options.endDate)
    : new Date(start.getTime() + 60 * 60 * 1000);
  const startStr = dateStrForAppleScript(start);
  const endStr = dateStrForAppleScript(end);

  const script = `
    tell application "Calendar"
      set targetCalendar to first calendar whose name is "${calendar}"
      tell targetCalendar
        make new event with properties {summary:"${title}", start date:date "${startStr}", end date:date "${endStr}", location:"${location}"}
      end tell
    end tell
    return "Created calendar event: ${title} on ${startStr}"
  `.trim();

  return runAppleScript(script);
}

/**
 * Get calendar events for today (and optionally the next `days` days).
 */
export async function getCalendarEvents(days = 1) {
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const end = new Date(startOfToday);
  end.setDate(end.getDate() + days);

  const startStr = dateStrForAppleScript(startOfToday);
  const endStr = dateStrForAppleScript(end);

  // Sort events by start date using AppleScript's timed event access. We pull
  // summary, start date, and location, separated by a token we can split on.
  const script = `
    tell application "Calendar"
      set startDate to date "${startStr}"
      set endDate to date "${endStr}"
      set matchingEvents to every event of (every calendar whose name is not "Birthdays") whose start date is greater than or equal to startDate and start date is less than endDate
      set output to ""
      repeat with ev in matchingEvents
        set output to output & "|" & (summary of ev) & " @ " & (start date of ev as string) & " - " & (location of ev as string)
      end repeat
      if output is "" then return "No calendar events in the next ${days} days."
      return output
    end tell
  `.trim();

  const result = await runAppleScript(script);
  if (
    result.startsWith("No calendar events") ||
    result.startsWith("macOS integration") ||
    result.startsWith("macOS blocked") ||
    result.startsWith("AppleScript failed")
  ) {
    return result;
  }
  const events = result
    .split("|")
    .filter((line) => line.trim().length > 0)
    .map((line) => `- ${line.trim()}`);
  return events.length > 0 ? events.join("\n") : "No calendar events found.";
}

// ---------------------------------------------------------------------------
// Reminders (Apple's Reminders.app - separate from Nexus's internal reminders)
// ---------------------------------------------------------------------------

export async function createAppleReminder(options: {
  title: string;
  dueDate?: string; // ISO date string
  list?: string;
}) {
  const title = options.title.replace(/"/g, '\\"');
  const reminderList = (options.list || "Reminders").replace(/"/g, '\\"');
  const dueDateStr = options.dueDate
    ? dateStrForAppleScript(new Date(options.dueDate))
    : null;
  const dueDateProp = dueDateStr ? `, due date:date "${dueDateStr}"` : "";

  const script = `
    tell application "Reminders"
      tell list "${reminderList}"
        make new reminder with properties {name:"${title}"${dueDateProp}}
      end tell
    end tell
    return "Added to Reminders: ${title}"
  `.trim();

  return runAppleScript(script);
}

export async function getAppleReminders() {
  const script = `
    tell application "Reminders"
      set output to ""
      repeat with r in reminders of default list
        if completed of r is false then
          set output to output & "☐ " & name of r & linefeed
        end if
      end repeat
      return output
    end tell
  `.trim();

  const result = await runAppleScript(script);
  if (result.includes("osascript") || result.includes("automation")) {
    return result;
  }
  return result.trim() || "No pending reminders.";
}

// ---------------------------------------------------------------------------
// Music / Media
// ---------------------------------------------------------------------------

export async function controlMusic(action: string, target = "") {
  const safeTarget = target.replace(/"/g, '\\"');

  // "Currently playing" reads state rather than mutating it.
  if (action === "currently_playing") {
    const script = `
      tell application "Music"
        if player state is playing then
          return "Now playing: " & (name of current track) & " by " & (artist of current track)
        else
          return "No music playing."
        end if
      end tell
    `.trim();
    return runAppleScript(script);
  }

  // Volume is a special case — uses the system volume command directly.
  if (action === "volume") {
    const vol = parseInt(target, 10) || 50;
    return runAppleScript(
      `
      set volume output volume ${Math.max(0, Math.min(100, vol))}
      return "Volume set to ${vol}%"
    `.trim(),
    );
  }

  let actionScript = "";
  switch (action) {
    case "play":
      actionScript = "play";
      break;
    case "pause":
    case "stop":
      actionScript = "pause";
      break;
    case "next":
      actionScript = "next track";
      break;
    case "previous":
    case "prev":
      actionScript = "previous track";
      break;
    case "playlist":
      actionScript = `play playlist "${safeTarget}"`;
      break;
    default:
      return `Unknown music action: ${action}`;
  }

  const script = `
    tell application "Music"
      ${actionScript}
    end tell
    return "Music: ${action} ${target ? safeTarget : ""}"
  `.trim();
  return runAppleScript(script);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function readNotifications() {
  // Notification Center isn't reliably AppleScriptable. Reading its items via
  // System Events works on some macOS versions; otherwise return a clear note.
  const script = `
    tell application "System Events"
      set output to ""
      repeat with n in (notification items of notification center)
        set output to output & (title of n) & ": " & (description of n) & linefeed
      end repeat
      return output
    end tell
  `.trim();

  const result = await runAppleScript(script);
  if (
    result.includes("automation unavailable") ||
    result.includes("AppleScript failed:")
  ) {
    return "Could not read notifications (Notification Center is not scriptable without accessibility permissions).";
  }
  return result.trim() || "No notifications in the notification center.";
}

// ---------------------------------------------------------------------------
// Context / System awareness
// ---------------------------------------------------------------------------

export async function getFrontmostApp() {
  const script = `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      return name of frontApp
    end tell
  `.trim();
  return runAppleScript(script);
}

export async function setDarkMode(on: boolean) {
  const script = `
    tell application "System Events"
      tell appearance preferences
        set dark mode to ${on ? "true" : "false"}
      end tell
    end tell
    return "Dark mode set to ${on}"
  `.trim();
  return runAppleScript(script);
}

export async function setVolume(percent: number) {
  return controlMusic("volume", String(percent));
}

export async function getVolume() {
  const script = `
    set vol to output volume of (get volume settings)
    return vol
  `.trim();
  const result = await runAppleScript(script);
  const num = parseInt(result, 10);
  if (Number.isFinite(num)) return `${num}% volume`;
  return result;
}
