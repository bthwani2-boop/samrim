"use client";

import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import { useServerInsertedHTML } from "next/navigation";
import { type ReactNode, useState } from "react";

/** Emits the first-screen Ant Design styles with the same nonce as the strict production CSP. */
export function AntDesignStyleRegistry({ children, nonce }: Readonly<{ children: ReactNode; nonce?: string | undefined }>) {
  const [cache] = useState(() => createCache());

  useServerInsertedHTML(() => {
    const css = extractStyle(cache, { plain: true, once: true });
    if (!css || css.includes('.data-ant-cssinjs-cache-path{content:"";}')) return null;
    return (
      <style
        id="antd-cssinjs"
        nonce={nonce}
        data-rc-order="prepend"
        data-rc-priority="-1000"
      >{css}</style>
    );
  });

  return <StyleProvider cache={cache}>{children}</StyleProvider>;
}
