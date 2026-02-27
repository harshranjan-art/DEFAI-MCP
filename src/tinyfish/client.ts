import 'dotenv/config';

export interface TFRequest {
  url: string;
  goal: string;
}

export interface TFResult {
  status: 'COMPLETE' | 'FAILED';
  data?: any;
}

export async function runTinyFish(req: TFRequest): Promise<TFResult> {
  try {
    const response = await fetch('https://agent.tinyfish.ai/v1/automation/run-sse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.TINYFISH_API_KEY || '',
      },
      body: JSON.stringify({ url: req.url, goal: req.goal }),
    });

    if (!response.ok || !response.body) return { status: 'FAILED' };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === 'COMPLETE') {
            return { status: 'COMPLETE', data: parsed.resultJson };
          }
        } catch { /* skip non-JSON data lines */ }
      }
    }
    return { status: 'FAILED' };
  } catch (e: any) {
    console.error('[TinyFish] Request failed:', e.message);
    return { status: 'FAILED' };
  }
}
