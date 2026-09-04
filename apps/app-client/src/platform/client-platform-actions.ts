import { File, Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { secureRandomId } from "@bthwani/dsh/mobile-capabilities";

export function createClientEphemeralId(prefix: string): string {
  return `${prefix}.${secureRandomId()}`;
}

export async function performClientSelectionHaptic(): Promise<void> {
  await Haptics.selectionAsync().catch(() => undefined);
}

export async function openClientExternalUrl(url: string): Promise<boolean> {
  const normalized = url.trim();
  if (!/^https:\/\//i.test(normalized)) return false;
  try {
    const result = await WebBrowser.openBrowserAsync(normalized);
    return result.type !== "cancel";
  } catch {
    return false;
  }
}

export async function shareClientTextDocument(input: {
  readonly fileNamePrefix: string;
  readonly contents: string;
  readonly dialogTitle: string;
}): Promise<boolean> {
  const contents = input.contents.trim();
  if (!contents) return false;

  const safePrefix = input.fileNamePrefix
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "bthwani-share";
  let file: File | null = null;

  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    file = new File(Paths.cache, `${safePrefix}-${secureRandomId()}.txt`);
    file.write(contents);
    await Sharing.shareAsync(file.uri, {
      dialogTitle: input.dialogTitle,
      mimeType: "text/plain",
      UTI: "public.plain-text",
    });
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (file?.exists) file.delete();
    } catch {
      // Cache cleanup is best effort and must never change the user-visible result.
    }
  }
}
