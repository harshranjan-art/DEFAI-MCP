const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('defai_jwt');
}

export function setToken(jwt: string): void {
  localStorage.setItem('defai_jwt', jwt);
}

export function clearToken(): void {
  localStorage.removeItem('defai_jwt');
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

// Auth
export const auth = {
  login: (api_key: string) =>
    request<{ jwt: string; userId: string; smartAccountAddress: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ api_key }),
    }),
  register: (private_key: string, passphrase: string) =>
    request<{ userId: string; apiKey: string; smartAccountAddress: string; jwt: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ private_key, passphrase }),
    }),
};

// Portfolio
export const portfolio = {
  get: () => request<any>('/portfolio'),
};

// Trades
export const trades = {
  get: (limit = 20, type?: string) =>
    request<{ trades: any[] }>(`/trades?limit=${limit}${type ? `&type=${type}` : ''}`),
};

// Markets
export const markets = {
  yields: () => request<{ yields: any[] }>('/markets/yields'),
  prices: (token = 'BNB') => request<{ quotes: any[] }>(`/markets/prices?token=${token}`),
  funding: () => request<{ rates: any }>('/markets/funding'),
  history: (limit = 100) => request<{ snapshots: any[] }>(`/markets/history?limit=${limit}`),
};

// Alerts
export const alerts = {
  get: () => request<{ alerts: any[] }>('/alerts'),
  unread: () => request<{ notifications: any[] }>('/alerts/unread'),
  markRead: (ids: string[]) =>
    request<{ success: boolean }>('/alerts/mark-read', {
      method: 'POST',
      body: JSON.stringify({ notification_ids: ids }),
    }),
};
