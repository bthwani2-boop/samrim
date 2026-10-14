"use client";

import { useEffect, useRef, useState } from "react";

export function StoreLogo({ name, uri, imageLabel = "شعار" }: Readonly<{ name: string; uri?: string | null | undefined; imageLabel?: string }>) {
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
          <button ref={triggerRef} className="store-logo-preview-trigger" type="button" title={`تكبير ${imageLabel} متجر ${name}`} aria-label={`تكبير ${imageLabel} متجر ${name}`} onClick={() => { setPreviewFailed(false); setPreviewOpen(true); }}>
            <img src={uri!} alt={`${imageLabel} متجر ${name}`} loading="lazy" decoding="async" onError={() => setFailedUri(uri!)} />
          </button>
        ) : (
          <span className="store-list-logo-placeholder" role="img" aria-label={`لا توجد صورة متاحة لمتجر ${name}`}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0]).join("") || "—"}</span>
        )}
      </span>
      {previewOpen && validImage ? (
        <dialog ref={dialogRef} className="catalog-image-dialog" aria-modal="true" aria-label={`${imageLabel} متجر ${name}`} onClose={close}>
          <div className="action-row">
            <button className="button button-secondary" type="button" onClick={close}>إغلاق الصورة</button>
          </div>
          <p className="muted">{imageLabel} متجر {name}</p>
          {previewFailed ? (
            <div role="alert">
              <p>تعذر تحميل صورة المتجر.</p>
              <button className="button button-secondary" type="button" onClick={() => setPreviewFailed(false)}>إعادة المحاولة</button>
            </div>
          ) : <img src={uri!} alt={`${imageLabel} متجر ${name}`} onError={() => setPreviewFailed(true)} />}
        </dialog>
      ) : null}
    </>
  );
}
