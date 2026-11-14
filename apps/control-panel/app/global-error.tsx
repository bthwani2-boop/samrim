"use client";

import OperatorError from "./error";

export default function GlobalError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <html lang="ar" dir="rtl">
      <head><meta name="robots" content="noindex,nofollow" /></head>
      <body style={{ fontFamily: "system-ui" }}>
        <OperatorError reset={reset} />
      </body>
    </html>
  );
}
