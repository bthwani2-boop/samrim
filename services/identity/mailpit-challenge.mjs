async function readMailpitMessages(port) {
  const response = await fetch(`http://127.0.0.1:${String(port).trim()}/api/v1/messages?limit=50`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Mailpit message listing returned ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.messages) ? body.messages : [];
}

function matchesMessage(message, phone, purpose) {
  return typeof message?.ID === "string" && typeof message?.Snippet === "string" && message.Snippet.includes(`Phone: ${phone}`) && message.Snippet.includes(`Purpose: ${purpose}`);
}

function challengeCode(messages, excluded, phone, purpose) {
  for (const message of messages) {
    if (excluded.has(message.ID) || !matchesMessage(message, phone, purpose)) continue;
    const match = /Code:\s*(\d{6})/.exec(message.Snippet);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function pollMailpitCode({ port, phone, purpose, excluded, attempts, intervalMs, attempt = 0 }) {
  try {
    const code = challengeCode(await readMailpitMessages(port), excluded, phone, purpose);
    if (code) return code;
  } catch {
    // Mailpit delivery is asynchronous; continue through the bounded proof window.
  }

  if (attempt + 1 >= attempts) {
    throw new Error(`${purpose} challenge was not delivered to controlled local Mailpit for ${phone}`);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  return pollMailpitCode({ port, phone, purpose, excluded, attempts, intervalMs, attempt: attempt + 1 });
}

export async function captureMailpitMessageIds({ port, phone, purpose }) {
  return (await readMailpitMessages(port)).filter((message) => matchesMessage(message, phone, purpose)).map((message) => message.ID);
}

export async function readMailpitCode({ port, phone, purpose, excludeMessageIds = [], attempts = 60, intervalMs = 200 }) {
  return pollMailpitCode({ port, phone, purpose, excluded: new Set(excludeMessageIds), attempts, intervalMs });
}
