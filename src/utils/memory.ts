import Supermemory from 'supermemory';
import 'dotenv/config';

const mem = new Supermemory();

export async function remember(userId: string, content: string): Promise<void> {
  try {
    await mem.documents.add({
      content,
      containerTags: ['user-' + userId],
    });
  } catch { /* never throws at call site */ }
}

export async function recall(userId: string, query: string): Promise<string> {
  try {
    const results = await mem.search.documents({
      q: query,
      containerTags: ['user-' + userId],
      limit: 5,
    });
    return results.results
      .map((r: any) => r.content || r.text || '')
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}
