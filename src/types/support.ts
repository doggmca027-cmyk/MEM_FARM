export type SupportSender = 'USER' | 'ADMIN';
export type SupportStatus = 'OPEN' | 'CLOSED';

export interface SupportMessage {
  id: string;
  sender: SupportSender;
  body: string;
  createdAt: number;
}

/** One user's support thread as the admin panel lists it. */
export interface AdminSupportThread {
  userId: string;
  username: string | null;
  firstName: string | null;
  telegramId: number | null;
  status: SupportStatus;
  lastMessageAt: number;
  lastPreview: string;
  lastSender: SupportSender;
  unreadAdmin: number;
}
