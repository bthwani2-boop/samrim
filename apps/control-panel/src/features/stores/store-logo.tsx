"use client";

import { useEffect, useRef, useState } from "react";

export function StoreLogo({ name, uri }: Readonly<{ name: string; uri?: string | null | undefined }>) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !previewOpen) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [previewOpen]);

  const close = () => {
    setPreviewOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const validImage = Boolean(uri && failedUri !== uri);
  return (
    <>
      <span className="store-list-logo">
        {validImage ? (
          <button ref={triggerRef} className="store-logo-preview-trigger" type="button" title={`تكبير شعار متجر ${name}`} aria-label={`تكبير شعار متجر ${name}`} onClick={() => { setPreviewFailed(false); setPreviewOpen(true); }}>
            <img src={uri!} alt={`شعار متجر ${name}`} loading="lazy" decoding="async" onError={() => setFailedUri(uri!)} />
          </button>
        ) : (
          <span className="store-list-logo-placeholder" role="img" aria-label={`لا يوجد شعار متاح لمتجر ${name}`}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0]).join("") || "—"}</span>
        )}
      </span>
      {previewOpen && validImage ? (
        <dialog ref={dialogRef} className="catalog-image-dialog" aria-modal="true" aria-label={`شعار متجر ${name}`} onClose={close}>
          <div className="action-row">
            <button className="button button-secondary" type="button" onClick={close}>إغلاق الصورة</button>
          </div>
          <p className="muted">شعار متجر {name}</p>
          {previewFailed ? (
            <div role="alert">
              <p>تعذر تحميل صورة المتجر.</p>
              <button className="button button-secondary" type="button" onClick={() => setPreviewFailed(false)}>إعادة المحاولة</button>
            </div>
          ) : <img src={uri!} alt={`شعار متجر ${name}`} onError={() => setPreviewFailed(true)} />}
        </dialog>
      ) : null}
    </>
  );
}
