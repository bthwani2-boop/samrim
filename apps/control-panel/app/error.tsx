"use client";

import { useEffect } from "react";

export default function OperatorError({ reset }: Readonly<{ reset: () => void }>) {
  useEffect(() => {
    document.getElementById("operator-error-title")?.focus();
  }, []);

  return (
    <main role="alert" aria-labelledby="operator-error-title" style={{ maxWidth: 720, margin: "40px auto" }}>
      <h1 id="operator-error-title" tabIndex={-1}>تعذّر عرض الصفحة</h1>
      <p>حدث خلل أثناء عرض هذه الصفحة. يمكنك إعادة المحاولة أو العودة إلى لوحة المشغّل.</p>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={reset}>إعادة المحاولة</button>
        {/* Reload even when the failed route is already "/", which a client-side Link cannot recover. */}
        <a href="/">العودة إلى لوحة المشغّل</a>
      </div>
    </main>
  );
}
