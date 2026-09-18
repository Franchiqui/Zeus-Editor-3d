export interface UserEditor3DRecord {
  id: string;
  name?: string;
  IP?: string;
  veces_conectado?: number;
  created: string;
  updated: string;
}

export interface UserTrackingResult {
  exists: boolean;
  user?: UserEditor3DRecord;
  ip?: string;
  isNew?: boolean;
  success?: boolean;
  error?: string;
}

export async function getUserIP(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    const data = await res.json();
    return data.ip || '';
  } catch {
    return '';
  }
}

export async function checkUser(): Promise<UserTrackingResult> {
  const res = await fetch('/api/user-tracking', { cache: 'no-store' });
  return res.json();
}

export async function registerUser(name: string): Promise<UserTrackingResult> {
  const res = await fetch('/api/user-tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function incrementConnectionCount(
  recordId: string,
  currentCount: number
): Promise<boolean> {
  return true;
}
