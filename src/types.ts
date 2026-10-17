export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}
export interface Button {
  text: string;
  callback_data: string;
}
export interface Reply {
  text: string;
  buttons?: Button[][];
  document?: string;
}
export interface Settings {
  user_id: number;
  timezone: string;
  language: string;
  reminders_enabled: number;
  state: string | null;
  state_expires: number | null;
}
export interface Note {
  id: string;
  user_id: number;
  title: string;
  content: string;
  category: string;
  archived: number;
  pinned: number;
  created_at: number;
  updated_at: number;
}
export interface Task {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  due_at: number | null;
  completed_at: number | null;
}
export interface Reminder {
  id: string;
  user_id: number;
  content: string;
  due_at: number;
  attempts: number;
  lease_token: string;
}
export interface Update {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { chat: { id: number; type: string } };
  };
}
export interface AIProvider {
  summarize(text: string): Promise<string>;
  suggestTags(text: string): Promise<string[]>;
  categorize(text: string): Promise<string>;
  search(query: string, userId: number): Promise<string[]>;
  extractTasks(text: string): Promise<string[]>;
}
// No provider is constructed or called by this release. Future providers require explicit user opt-in.
