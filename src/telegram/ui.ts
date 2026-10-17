import type { Button, Reply } from "../types";
export const button = (text: string, callback_data: string): Button => ({
  text,
  callback_data,
});
export const home = [
  [button("📝 Add note", "add"), button("🔎 Search", "search")],
  [button("My notes", "notes:0"), button("Tasks", "tasks:pending:0")],
  [button("Reminders", "reminders:0"), button("Vocabulary", "vocab:0")],
  [button("Settings", "settings"), button("Help", "help")],
];
export function reply(
  text: string,
  buttons: Button[][] = [[button("⌂ Menu", "home")]],
): Reply {
  return { text, buttons };
}
export function pager(prefix: string, p: number, more: boolean): Button[] {
  return [
    ...(p > 0 ? [button("← Previous", `${prefix}:${p - 1}`)] : []),
    ...(more ? [button("Next →", `${prefix}:${p + 1}`)] : []),
  ];
}
export const help = `Capture anything: simply send text (up to 4,000 characters).\n\n/notes — browse, filter and sort\n/search — words or an exact phrase in double quotes; #tag; category:Learning; archived:true; pinned:true; sort:oldest or sort:updated\n/tasks /today /overdue — tasks\n/reminders /cancel_reminder — reminders\n/vocab — vocabulary\n/stats — activity\n/settings — timezone, export and deletion\n/cancel — cancel the current input\n\nReminder example: Remind me in 10 minutes to study Python. You confirm the exact time before saving. UTC is used until you set your timezone.\n\nEnglish is fully supported. No AI service is used.`;
