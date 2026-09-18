export async function readMailpitCode({ port, phone, purpose, attempts = 60, intervalMs = 200 }) {
  const base = `http://127.0.0.1:${String(port).trim()}`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/view/latest.txt`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        const message = await response.text();
        if (message.includes(`Phone: ${phone}`) && message.includes(`Purpose: ${purpose}`)) {
          const match = message.match(/Code:\s*(\d{6})/);
          if (match?.[1]) return match[1];
        }
      }
    } catch {
      // Mailpit delivery is asynchronous; continue through the bounded proof window.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${purpose} challenge was not delivered to controlled local Mailpit for ${phone}`);
}
