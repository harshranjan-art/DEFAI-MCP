import { runTinyFish } from './client';

export interface SecurityCheck {
  safe: boolean;
  warning?: string;
}

const SECURITY_TIMEOUT_MS = 8000;

export async function checkProtocolSecurity(protocol: string): Promise<SecurityCheck> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TinyFish timeout')), SECURITY_TIMEOUT_MS)
    );
    const result = await Promise.race([
      runTinyFish({
        url: 'https://rekt.news',
        goal: `Scan headlines for any mentions of "${protocol}" in the last 14 days. Return JSON: { safe: boolean, warning: string | null }`,
      }),
      timeoutPromise,
    ]);
    if (result.status === 'COMPLETE' && result.data) {
      try {
        const d = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
        return { safe: d.safe !== false, warning: d.warning || undefined };
      } catch { /* fall through */ }
    }
  } catch { /* never block user on monitor failure */ }
  return { safe: true };
}
