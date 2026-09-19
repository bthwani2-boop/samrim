async function readMailpitMessages(port) {
  const response = await fetch(`http://127.0.0.1:${String(port).trim()}/api/v1/messages?limit=50`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Mailpit message listing returned ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.messages) ? body.messages : [];
}

function matchesMessage(message, phone, purpose) {
  return typeof message?.ID === "string" && typeof message?.Snippet === "string" && message.Snippet.includes(`Phone: ${phone}`) && message.Snippet.includes(`Purpose: ${purpose}`);
}

export async function captureMailpitMessageIds({ port, phone, purpose }) {
  return (await readMailpitMessages(port)).filter((message) => matchesMessage(message, phone, purpose)).map((message) => message.ID);
}

export async function readMailpitCode({ port, phone, purpose, excludeMessageIds = [], attempts = 60, intervalMs = 200 }) {
  const excluded = new Set(excludeMessageIds);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const messages = await readMailpitMessages(port);
      for (const message of messages) {
        if (excluded.has(message.ID) || !matchesMessage(message, phone, purpose)) continue;
        const match = message.Snippet.match(/Code:\s*(\d{6})/);
        if (match?.[1]) return match[1];
      }
    } catch {
      // Mailpit delivery is asynchronous; continue through the bounded proof window.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${purpose} challenge was not delivered to controlled local Mailpit for ${phone}`);
}
