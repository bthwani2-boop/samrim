"use client";

import { useEffect, useRef, useState } from "react";

// Only image-address schemes are accepted; never put arbitrary persisted
// or client-provided strings directly into image source attributes.
export function safeStoreImageURI(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  if (/^\/(?!\/)[^\s<>"']+$/.test(value)) return value;
  if (/^https?:\/\/[^\s<>"']+$/i.test(value)) return value;
  if (/^blob:https?:\/\/[^\s<>"']+$/i.test(value)) return value;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  return null;
}

export function StoreLogo({ name, uri, imageLabel = "شعار", allowPreview = true }: Readonly<{ name: string; uri?: string | null | undefined; imageLabel?: string; allowPreview?: boolean }>) {
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

  const safeURI = safeStoreImageURI(uri);
  const validImage = Boolean(safeURI && failedUri !== uri);
  return (
    <>
      <span className="store-list-logo">
        {validImage ? (!allowPreview ? <img src={safeURI ?? undefined} alt={`${imageLabel} متجر ${name}`} loading="lazy" decoding="async" onError={() => setFailedUri(uri!)} /> :
          <button ref={triggerRef} className="store-logo-preview-trigger" type="button" title={`تكبير ${imageLabel} متجر ${name}`} aria-label={`تكبير ${imageLabel} متجر ${name}`} onClick={() => { setPreviewFailed(false); setPreviewOpen(true); }}>
            <img src={safeURI ?? undefined} alt={`${imageLabel} متجر ${name}`} loading="lazy" decoding="async" onError={() => setFailedUri(uri!)} />
          </button>
        ) : (
          <span className="store-list-logo-placeholder" role="img" aria-label={`لا توجد صورة متاحة لمتجر ${name}`}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0]).join("") || "—"}</span>
        )}
      </span>
      {previewOpen && validImage && allowPreview ? (
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
          ) : <img src={safeURI ?? undefined} alt={`${imageLabel} متجر ${name}`} onError={() => setPreviewFailed(true)} />}
        </dialog>
      ) : null}
    </>
  );
}
