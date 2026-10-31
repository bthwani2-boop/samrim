"use client";

import { resolveTheme } from "@bthwani/design-system";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { PublishedBannerSettings } from "./published-banner-settings";
import {
  defaultStudioDraft,
  isStudioHex,
  moveStudioSection,
  parseStudioDraft,
  studioContrastRatio,
  studioPaletteNames,
  studioPaletteWarnings,
  studioSectionLabels,
  type StudioAppearance,
  type StudioDraft,
  type StudioPaletteKey,
  type StudioSection,
  type StudioSectionId,
  type StudioSlide,
  type StudioViewport,
} from "./studio-draft";

const storagePrefix = "bthwani-studio-private-draft-v1:";
type EditorPanel = "sections" | "palette" | "published";
const viewports: ReadonlyArray<{ id: StudioViewport; label: string }> = [
  { id: "desktop", label: "الحاسوب" }, { id: "tablet", label: "اللوحي" }, { id: "phone", label: "الهاتف" },
];

function PreviewSection({ section, draft, currentSlide, onSlideSelect }: Readonly<{
  section: StudioSection;
  draft: StudioDraft;
  currentSlide: number;
  onSlideSelect: (index: number) => void;
}>) {
  if (!section.visible) return null;
  if (section.id === "hero") {
    const slide = draft.slides[currentSlide % draft.slides.length]!;
    return <section className={"studio-mock-hero studio-mock-hero-" + draft.heroOptions.height + " studio-mock-align-" + draft.heroOptions.align} aria-label="معاينة العرض الرئيسي">
      <div className="studio-mock-hero-content">
        <span className="studio-mock-eyebrow">بثواني · توصيل من متاجرك</span>
        <h2>{slide.title || section.title}</h2>
        {draft.heroOptions.showDescription ? <p>{slide.description || section.description}</p> : null}
        {draft.heroOptions.showButton ? <span className="studio-mock-button">{slide.buttonLabel || "استكشف"}</span> : null}
      </div>
      <div className="studio-mock-hero-decoration" aria-hidden="true"><span>بـ</span></div>
      {draft.heroOptions.showDots && draft.slides.length > 1 ? <nav className="studio-mock-slide-controls" aria-label="شرائح العرض">
        {draft.slides.map((item, index) => <button type="button" key={item.id} aria-label={`عرض الشريحة ${index + 1}`} aria-pressed={index === currentSlide} onClick={() => onSlideSelect(index)} />)}
      </nav> : null}
    </section>;
  }

  const samples: Record<Exclude<StudioSectionId, "hero">, ReadonlyArray<string>> = {
    benefits: ["اختيارات واضحة", "متابعة الطلب", "متاجر محلية", "دعم المستخدم"],
    services: ["المقاضي", "المطاعم", "الصيدليات", "الغاز", "اخدمني", "الهدايا", "الخضار", "المخابز"],
    stores: ["متجر قريب", "متجر المقاضي", "متجر محلي", "مشروع منزلي", "متجر مختار", "متجر متاح", "متجر حي", "متجر جديد"],
    products: ["منتج تجريبي", "اختيار يومي", "منتج مميز", "منتج محلي", "منتج جديد", "منتج متاح", "منتج مختار", "عرض منتج"],
    curated: ["مجموعة منتجات", "مختارات الموسم", "قائمة منتجات", "توصيات", "مجموعة إضافية"],
    banners: ["بنر توضيحي", "مساحة إعلانية", "رسالة ترويجية", "حملة موسمية"],
    topSellers: ["منتج 1", "منتج 2", "منتج 3", "منتج 4", "منتج 5"],
    promotions: ["عرض توضيحي", "مساحة حملة", "عرض آخر", "بنر موسمي", "حملة محلية", "مساحة عرض", "حملة جديدة", "عرض قادم"],
    testimonials: ["بطاقة رأي تجريبية", "رأي توضيحي", "انطباع افتراضي"],
    brands: ["شريك محلي", "متجر 2", "متجر 3", "متجر 4", "متجر 5"],
    trust: ["اختر متجرك", "أكمل طلبك", "تابع التوصيل", "استلم طلبك", "اختر الخدمة", "تواصل بسهولة", "تابع الحالة", "اطلب مجددًا"],
  };
  const sampleLabels = samples[section.id];
  return <section className="studio-mock-section" aria-label={section.title || studioSectionLabels[section.id]}>
    <div className="studio-mock-section-heading">
      <div><h3>{section.title || studioSectionLabels[section.id]}</h3><p>{section.description}</p></div>
      <span className="studio-mock-section-meta">{studioSectionLabels[section.id]}</span>
    </div>
    <div className={`studio-mock-grid studio-mock-grid-${section.id}`}>
      {Array.from({ length: section.count }, (_, index) => sampleLabels[index] ?? "عنصر توضيحي " + (index + 1)).map((title) => <div className="studio-mock-tile" key={`${section.id}-${title}`}>
        <div className="studio-mock-media" aria-hidden="true"><span>{section.id === "services" ? "◈" : section.id === "promotions" ? "✦" : "▧"}</span></div>
        <strong>{title}</strong>
        {section.id === "products" || section.id === "stores" ? <small>مثال للعرض فقط</small> : null}
      </div>)}
    </div>
  </section>;
}

type SharedStudioRecord = Readonly<{
  templateKey: "CLIENT_HOME";
  document: StudioDraft | null;
  version: number;
  updatedByActorId: string;
}>;

function parseSharedRecord(input: unknown): SharedStudioRecord | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (record.templateKey !== "CLIENT_HOME" || !Number.isInteger(record.version) ||
      Number(record.version) < 1 || typeof record.updatedByActorId !== "string") return null;
  const document = record.document === null ? null : parseStudioDraft(record.document);
  if (record.document !== null && !document) return null;
  return { templateKey: "CLIENT_HOME", document, version: Number(record.version), updatedByActorId: record.updatedByActorId };
}

function Editor({ actorId }: Readonly<{ actorId: string }>) {
  const [draft, setDraft] = useState<StudioDraft>(defaultStudioDraft);
  const [hexInputs, setHexInputs] = useState(defaultStudioDraft().palette);
  const [selectedId, setSelectedId] = useState<StudioSectionId>("hero");
  const [panel, setPanel] = useState<EditorPanel>("sections");
  const [viewport, setViewport] = useState<StudioViewport>("desktop");
  const [appearance, setAppearance] = useState<StudioAppearance>("light");
  const [slideIndex, setSlideIndex] = useState(0);
  const [dragging, setDragging] = useState<StudioSectionId | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    if (!draft.autoplay || draft.slides.length < 2 || !draft.sections.some((entry) => entry.id === "hero" && entry.visible)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setSlideIndex((previous) => (previous + 1) % draft.slides.length);
    }, draft.intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [draft.autoplay, draft.slides.length, draft.intervalSeconds, draft.sections]);
  const [loadFailure, setLoadFailure] = useState(false);
  const [shared, setShared] = useState<SharedStudioRecord | null>(null);
  const [sharedBusy, setSharedBusy] = useState(false);
  const [sharedError, setSharedError] = useState("");
  const [sharedRefresh, setSharedRefresh] = useState(0);
  const pendingSharedKey = useRef<string | null>(null);
  const draftRevision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    if (sharedRefresh > 0) setShared(null);
    setSharedError("");
    void (async () => {
      try {
        const response = await fetch("/api/marketing/studio-draft", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("خدمة مسودات الفريق غير متاحة. المسودة المحلية لا تزال قابلة للتحرير.");
        const body = await response.json() as unknown;
        const record = parseSharedRecord(body);
        if (!record) throw new Error("استجابة مسودات الفريق غير صالحة، ولم تُغيَّر مسودتك المحلية.");
        if (!controller.signal.aborted) setShared(record);
      } catch (error) {
        if (!controller.signal.aborted) {
          setShared(null);
          setSharedError(error instanceof Error ? error.message : "تعذر قراءة مسودة الفريق.");
        }
      }
    })();
    return () => controller.abort();
  }, [sharedRefresh]);

  useEffect(() => {
    const key = storagePrefix + actorId;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw && raw.length > 24000) {
        setNotice("المسودة المحفوظة كبيرة أو غير صالحة؛ استخدمنا القيم الافتراضية دون حذفها.");
        setLoadFailure(true);
      } else if (raw) {
        const parsed = parseStudioDraft(JSON.parse(raw) as unknown);
        if (parsed) { setDraft(parsed); setNotice("تم فتح مسودتك المحلية المحفوظة."); }
        else { setNotice("تعذر التحقق من المسودة المحفوظة؛ عُرض القالب الافتراضي دون حذفها."); setLoadFailure(true); }
      } else setNotice("ابدأ بالتحرير ثم احفظ مسودة محلية؛ لن يتغير تطبيق العميل.");
    } catch {
      setNotice("تعذر قراءة التخزين المحلي؛ تستطيع تجربة المحرر دون حفظ.");
      setLoadFailure(true);
    }
    setStorageReady(true);
  }, [actorId]);

  useEffect(() => { setHexInputs(draft.palette); }, [draft.palette]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const change = (transform: (previous: StudioDraft) => StudioDraft) => {
    draftRevision.current += 1;
    pendingSharedKey.current = null;
    setDraft(transform);
    setDirty(true);
    setNotice("تغييرات غير محفوظة. المعاينة محلية وغير منشورة.");
  };
  const updateSection = (id: StudioSectionId, patch: Partial<StudioSection>) => change((previous) => ({
    ...previous,
    sections: previous.sections.map((section) => section.id === id ? { ...section, ...patch } : section),
  }));
  const updateSlide = (id: string, patch: Partial<StudioSlide>) => change((previous) => ({
    ...previous,
    slides: previous.slides.map((slide) => slide.id === id ? { ...slide, ...patch } : slide),
  }));
  const updatePalette = (key: StudioPaletteKey, value: string) => {
    if (!isStudioHex(value)) return;
    change((previous) => ({ ...previous, palette: { ...previous.palette, [key]: value.toUpperCase() } }));
  };
  const move = (id: StudioSectionId, direction: -1 | 1) => {
    const index = draft.sections.findIndex((entry) => entry.id === id);
    const sibling = draft.sections[index + direction];
    if (sibling) change((current) => ({ ...current, sections: moveStudioSection(current.sections, id, sibling.id) }));
  };
  const save = () => {
    const next = parseStudioDraft(draft);
    if (!next) { setNotice("المسودة غير صالحة؛ راجع الحقول قبل الحفظ."); return; }
    try {
      window.localStorage.setItem(storagePrefix + actorId, JSON.stringify(next));
      setDirty(false);
      setLoadFailure(false);
      setNotice("حُفظت المسودة محليًا لهذا المشغّل في هذا المتصفح فقط. لم تُنشر.");
    } catch { setNotice("فشل الحفظ المحلي. لم تُنشر أي تغييرات."); }
  };
  async function saveShared() {
    const validated = parseStudioDraft(draft);
    if (!validated || !shared || sharedBusy ||
        studioPaletteNames.some((entry) => hexInputs[entry.key] !== draft.palette[entry.key])) {
      setSharedError("تحقق من صلاحية الألوان ومن توفر إصدار مسودة الفريق قبل الحفظ.");
      return;
    }
    const revisionAtStart = draftRevision.current;
    const requestKey = pendingSharedKey.current ?? crypto.randomUUID();
    pendingSharedKey.current = requestKey;
    setSharedBusy(true);
    setSharedError("");
    try {
      const response = await fetch("/api/marketing/studio-draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: validated, expectedVersion: shared.version, idempotencyKey: requestKey }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          pendingSharedKey.current = null;
          throw new Error("تغيّر إصدار مسودة الفريق من جلسة أخرى. حدّث الحالة وقارن التعديلات قبل إعادة الحفظ.");
        }
        throw new Error("تعذر حفظ مسودة الفريق. لم تُنشر تغييرات، ويمكن إعادة المحاولة.");
      }
      const body = await response.json() as { draft?: unknown };
      const saved = parseSharedRecord(body.draft);
      if (!saved || !saved.document) throw new Error("استجابة حفظ مسودة الفريق غير صالحة؛ تحقق من الحالة قبل إعادة المحاولة.");
      setShared(saved);
      pendingSharedKey.current = null;
      if (revisionAtStart === draftRevision.current) {
        try {
          window.localStorage.setItem(storagePrefix + actorId, JSON.stringify(saved.document));
          setDirty(false);
          setNotice("حُفظت المسودة المشتركة على DSH وفي المتصفح. لم تُنشر للتطبيقات.");
        } catch {
          setDirty(false);
          setNotice("حُفظت المسودة المشتركة على DSH؛ تعذر حفظ نسختها في هذا المتصفح.");
        }
      } else {
        setNotice("حُفظت نسخة سابقة من المسودة على DSH؛ لديك تعديلات أحدث لم تُحفظ بعد.");
      }
    } catch (error) {
      setSharedError(error instanceof Error ? error.message : "تعذر حفظ مسودة الفريق.");
    } finally {
      setSharedBusy(false);
    }
  }
  function importShared() {
    if (!shared?.document) return;
    if (!window.confirm("استبدال معاينتك ومسودتك المحلية بمسودة الفريق؟ سيُستبدل الحفظ المحلي السابق لهذا المشغّل.")) return;
    draftRevision.current += 1;
    pendingSharedKey.current = null;
    setDraft(shared.document);
    setSlideIndex(0);
    try {
      window.localStorage.setItem(storagePrefix + actorId, JSON.stringify(shared.document));
      setDirty(false);
      setNotice("استُوردت مسودة الفريق إلى المعاينة والمسودة المحلية، دون نشر.");
    } catch {
      setDirty(true);
      setNotice("استُوردت المسودة للمعاينة؛ فشل الحفظ المحلي. احفظها قبل إغلاق الصفحة.");
    }
  }

  const reset = () => {
    if (!window.confirm("استعادة الألوان والأقسام الافتراضية في المحرر؟ المسودة المحفوظة لن تُستبدل إلا بعد الضغط على حفظ المسودة.")) return;
    draftRevision.current += 1;
    pendingSharedKey.current = null;
    setDraft(defaultStudioDraft());
    setSlideIndex(0);
    setDirty(true);
    setNotice("عادت المعاينة إلى القالب الافتراضي. احفظ المسودة إذا أردت الاحتفاظ بالتغيير.");
  };
  const section = draft.sections.find((entry) => entry.id === selectedId) ?? draft.sections[0]!;
  const warnings = studioPaletteWarnings(draft.palette);
  const theme = resolveTheme(appearance);
  const previewStyle = {
    "--studio-navy": draft.palette.navy,
    "--studio-orange": draft.palette.orange,
    "--studio-turquoise": draft.palette.turquoise,
    "--studio-burgundy": draft.palette.burgundy,
    "--studio-surface": appearance === "dark" ? theme.surface : draft.palette.white,
    "--studio-ink": appearance === "dark" ? theme.color : draft.palette.navy,
    "--studio-subtle": theme.colorMuted,
    "--studio-inset": theme.surfaceInset,
    "--studio-border": theme.borderColor,
    "--studio-on-hero": draft.palette.white,
  } as CSSProperties;

  if (!storageReady) return <p role="status">جارٍ تجهيز الاستوديو...</p>;
  return <section className="workspace-page studio-root" aria-label="استوديو تصميم القالب" data-testid="studio-root">
    <PageHeader title="استوديو القالب" />
    <div className="studio-topbar">
      <div className="studio-topbar-copy">
        <strong>قالب بثواني الافتراضي · رئيسية العميل</strong>
        <p>تحرير تخطيطي ومعاينة فورية. النشر إلى التطبيقات يتطلب ربط DSH المعتمد.</p>
      </div>
      <div className="studio-topbar-actions">
        <button type="button" className="button button-secondary" onClick={reset}>استعادة الافتراضي</button>
        <button type="button" className="button button-secondary" disabled={sharedBusy} onClick={() => setSharedRefresh((value) => value + 1)}>تحديث حالة الفريق</button>
        {shared?.document ? <button type="button" className="button button-secondary" disabled={sharedBusy} onClick={importShared}>استيراد مسودة الفريق</button> : null}
        <button type="button" className="button button-primary" disabled={!shared || sharedBusy || studioPaletteNames.some((entry) => hexInputs[entry.key] !== draft.palette[entry.key])} onClick={() => void saveShared()}>{sharedBusy ? "جارٍ الحفظ…" : "حفظ مسودة الفريق"}</button>
        <button type="button" className="button button-primary" onClick={save} disabled={(!dirty && !loadFailure) || studioPaletteNames.some((entry) => hexInputs[entry.key] !== draft.palette[entry.key])}>حفظ المسودة محليًا</button>
      </div>
    </div>
    <p role="status" className="studio-status">{notice}</p>
    <p role="status" className="studio-status">
      {shared ? "مسودة الفريق: الإصدار " + shared.version + (shared.document ? " · قابلة للاستيراد" : " · لم تُحفظ بعد") : "لم تُحمَّل حالة مسودة الفريق بعد"}
    </p>
    {sharedError ? <p role="alert" className="studio-warning">{sharedError}</p> : null}

    <div className="studio-workbench">
      <aside className="studio-pane studio-section-pane" aria-label="أقسام القالب">
        <div className="studio-pane-heading"><h2>أقسام الصفحة</h2><small>{draft.sections.filter((entry) => entry.visible).length} ظاهرة من {draft.sections.length}</small></div>
        <p className="studio-guidance">اسحب القسم لترتيبه، أو استخدم الأسهم بلوحة المفاتيح.</p>
        <ol className="studio-section-list">
          {draft.sections.map((entry, index) => <li key={entry.id}
            draggable
            onDragStart={() => setDragging(entry.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (dragging && dragging !== entry.id) change((current) => ({ ...current, sections: moveStudioSection(current.sections, dragging, entry.id) })); setDragging(null); }}
            onDragEnd={() => setDragging(null)}
            className={`studio-section-item ${entry.id === selectedId ? "is-selected" : ""}`}
          >
            <button type="button" className="studio-section-select" aria-pressed={entry.id === selectedId} onClick={() => { setSelectedId(entry.id); setPanel("sections"); }}>
              <span aria-hidden="true" className="studio-grip">⠿</span>
              <span><strong>{studioSectionLabels[entry.id]}</strong><small>{entry.visible ? "ظاهر" : "مخفي"} · {index + 1}</small></span>
            </button>
            <div className="studio-section-actions">
              <button type="button" title="نقل لأعلى" aria-label={`نقل ${studioSectionLabels[entry.id]} لأعلى`} disabled={index === 0} onClick={() => move(entry.id, -1)}>↑</button>
              <button type="button" title="نقل لأسفل" aria-label={`نقل ${studioSectionLabels[entry.id]} لأسفل`} disabled={index === draft.sections.length - 1} onClick={() => move(entry.id, 1)}>↓</button>
              <label className="studio-visibility" title={entry.visible ? "إخفاء القسم" : "إظهار القسم"}>
                <input aria-label={`إظهار ${studioSectionLabels[entry.id]}`} type="checkbox" checked={entry.visible} onChange={(event) => updateSection(entry.id, { visible: event.target.checked })} />
              </label>
            </div>
          </li>)}
        </ol>
        <p className="studio-guidance">القائمة مخصصة لتكوين الصفحة، ولا تنشئ منتجات أو عروضًا جديدة.</p>
      </aside>

      <section className="studio-center" aria-label="معاينة القالب">
        <div className="studio-preview-toolbar">
          <strong>المعاينة الحية</strong>
          <fieldset aria-label="حجم المعاينة" className="studio-segment">
            {viewports.map((item) => <button key={item.id} type="button" aria-pressed={viewport === item.id} onClick={() => setViewport(item.id)}>{item.label}</button>)}
          </fieldset>
          <fieldset aria-label="مظهر المعاينة" className="studio-segment">
            <button type="button" aria-pressed={appearance === "light"} onClick={() => setAppearance("light")}>نهاري</button>
            <button type="button" aria-pressed={appearance === "dark"} onClick={() => setAppearance("dark")}>ليلي</button>
          </fieldset>
        </div>
        <div className="studio-preview-board">
          <div className="studio-preview-canvas" data-viewport={viewport} data-appearance={appearance} style={previewStyle}>
            <div className="studio-mock-browser">
              <span className="studio-mock-brand">بثواني<span aria-hidden="true">.</span></span>
              <span className="studio-mock-search">ابحث عن متجر أو منتج...</span>
              <span className="studio-mock-account" aria-hidden="true">◯</span>
            </div>
            <div className="studio-mock-main">
              {draft.sections.some((entry) => entry.visible) ? draft.sections.map((entry) => <PreviewSection key={entry.id} section={entry} draft={draft} currentSlide={slideIndex} onSlideSelect={setSlideIndex} />) : <div className="studio-mock-empty">كل الأقسام مخفية. فعّل قسمًا لإظهار المعاينة.</div>}
              <footer className="studio-mock-footer">بثواني · هذه معاينة تخطيطية وليست محتوى منشورًا</footer>
            </div>
          </div>
        </div>
        <p className="studio-preview-disclaimer">المعاينة تستخدم بيانات توضيحية ولا تساوي العرض النهائي للتطبيق قبل ربط المستهلك الحقيقي.</p>
      </section>

      <aside className="studio-pane studio-inspector" aria-label="لوحة تحرير القالب">
        <div role="tablist" aria-label="أدوات الاستوديو" className="studio-inspector-tabs">
          <button type="button" role="tab" aria-selected={panel === "sections"} onClick={() => setPanel("sections")}>إعدادات القسم</button>
          <button type="button" role="tab" aria-selected={panel === "palette"} onClick={() => setPanel("palette")}>الألوان</button>
          <button type="button" role="tab" aria-selected={panel === "published"} onClick={() => setPanel("published")}>البنرات المنشورة</button>
        </div>
        {panel === "published" ? <div role="tabpanel" className="studio-inspector-content">
          <p className="studio-guidance">إعدادات حركة البنرات الفعلية من DSH، مستقلة عن مسودة تصميم القالب. يتطلب حفظها صلاحية التسويق ويُتحقق من الإصدار على الخادم.</p>
          <PublishedBannerSettings />
          <Link className="button button-secondary" href="/marketing?section=content">إدارة صور البنرات ووجهاتها</Link>
        </div> : panel === "sections" ? <div role="tabpanel" className="studio-inspector-content">
          <h2>{studioSectionLabels[section.id]}</h2>
          <label className="studio-check"><input type="checkbox" checked={section.visible} onChange={(event) => updateSection(section.id, { visible: event.target.checked })} />إظهار القسم</label>
          <label className="studio-field">عنوان القسم
            <input value={section.title} maxLength={80} onChange={(event) => updateSection(section.id, { title: event.target.value })} />
          </label>
          <label className="studio-field">وصف مختصر
            <textarea rows={3} value={section.description} maxLength={180} onChange={(event) => updateSection(section.id, { description: event.target.value })} />
          </label>
          {section.id !== "hero" ? <label className="studio-field">عدد العناصر في المعاينة
            <select value={section.count} onChange={(event) => updateSection(section.id, { count: Number(event.target.value) })}>
              {[2, 3, 4, 5, 6, 8].map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label> : <>
            <h3>إعدادات السلايدر</h3>
            <label className="studio-field">ارتفاع العرض
              <select value={draft.heroOptions.height} onChange={(event) => change((prev) => ({ ...prev, heroOptions: { ...prev.heroOptions, height: event.target.value as StudioDraft["heroOptions"]["height"] } }))}>
                <option value="compact">صغير</option><option value="regular">متوسط</option><option value="tall">كبير</option>
              </select>
            </label>
            <label className="studio-field">محاذاة النص
              <select value={draft.heroOptions.align} onChange={(event) => change((prev) => ({ ...prev, heroOptions: { ...prev.heroOptions, align: event.target.value as StudioDraft["heroOptions"]["align"] } }))}>
                <option value="start">بداية</option><option value="center">وسط</option><option value="end">نهاية</option>
              </select>
            </label>
            <label className="studio-check"><input type="checkbox" checked={draft.heroOptions.showDescription} onChange={(event) => change((prev) => ({ ...prev, heroOptions: { ...prev.heroOptions, showDescription: event.target.checked } }))} />إظهار النص التفصيلي</label>
            <label className="studio-check"><input type="checkbox" checked={draft.heroOptions.showButton} onChange={(event) => change((prev) => ({ ...prev, heroOptions: { ...prev.heroOptions, showButton: event.target.checked } }))} />إظهار زر العرض</label>
            <label className="studio-check"><input type="checkbox" checked={draft.heroOptions.showDots} onChange={(event) => change((prev) => ({ ...prev, heroOptions: { ...prev.heroOptions, showDots: event.target.checked } }))} />إظهار مؤشرات الشرائح</label>
            <label className="studio-check"><input type="checkbox" checked={draft.autoplay} onChange={(event) => change((prev) => ({ ...prev, autoplay: event.target.checked }))} />تشغيل تلقائي عند ربط العرض الفعلي</label>
            <label className="studio-field">الفاصل الزمني (ثوانٍ)
              <select value={draft.intervalSeconds} disabled={!draft.autoplay} onChange={(event) => change((prev) => ({ ...prev, intervalSeconds: Number(event.target.value) }))}>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <h3>الشرائح ({draft.slides.length})</h3>
            {draft.slides.map((slide, index) => <fieldset key={slide.id} className="studio-slide-fields">
              <legend>الشريحة {index + 1}</legend>
              <label className="studio-field">العنوان<input value={slide.title} maxLength={80} onChange={(event) => updateSlide(slide.id, { title: event.target.value })} /></label>
              <label className="studio-field">النص<textarea value={slide.description} rows={2} maxLength={180} onChange={(event) => updateSlide(slide.id, { description: event.target.value })} /></label>
              <label className="studio-field">نص الزر<input value={slide.buttonLabel} maxLength={40} onChange={(event) => updateSlide(slide.id, { buttonLabel: event.target.value })} /></label>
              <button type="button" className="button button-secondary" disabled={draft.slides.length === 1} onClick={() => { change((prev) => ({ ...prev, slides: prev.slides.filter((candidate) => candidate.id !== slide.id) })); setSlideIndex(0); }}>حذف الشريحة</button>
            </fieldset>)}
            <button className="button button-secondary" type="button" disabled={draft.slides.length >= 4} onClick={() => change((prev) => ({
              ...prev,
              slides: [...prev.slides, { id: `slide-${Math.max(0, ...prev.slides.map((item) => Number(item.id.split("-")[1]) || 0)) + 1}`, title: "شريحة جديدة", description: "", buttonLabel: "استكشف" }],
            }))}>إضافة شريحة</button>
            <p className="studio-guidance">الصور والفيديو تُدار حاليًا من <Link href="/marketing?section=content">مركز المحتوى التسويقي</Link>. لا يرفع هذا المحرر وسائط إلى الخادم.</p>
          </>}
        </div> : <div role="tabpanel" className="studio-inspector-content">
          <h2>الألوان الافتراضية</h2>
          <p className="studio-guidance">هذه الدرجات الخمس مضمّنة أصلًا في الكود. يمكنك تغييرها هنا للمعاينة والمسودة فقط.</p>
          {studioPaletteNames.map((entry) => <label className="studio-field studio-color-field" key={entry.key}>
            {entry.label}
            <span className="studio-color-inputs">
              <input aria-label={`اختيار ${entry.label}`} type="color" value={draft.palette[entry.key]} onChange={(event) => updatePalette(entry.key, event.target.value)} />
              <input aria-label={`رمز ${entry.label}`} type="text" spellCheck={false} dir="ltr" maxLength={7} value={hexInputs[entry.key]} onChange={(event) => {
                const next = event.target.value.toUpperCase();
                setHexInputs((previous) => ({ ...previous, [entry.key]: next }));
                if (isStudioHex(next)) updatePalette(entry.key, next);
              }} onBlur={() => setHexInputs((previous) => ({ ...previous, [entry.key]: draft.palette[entry.key] }))} />
            </span>
            {!isStudioHex(hexInputs[entry.key]) ? <small role="alert" className="studio-warning">أدخل رمزًا سداسيًا كاملًا مثل #102B4E.</small> : null}
          </label>)}
          <p className="studio-contrast" role="status">تباين الكحلي مع الأبيض: {studioContrastRatio(draft.palette.navy, draft.palette.white).toFixed(2)}:1</p>
          {warnings.length ? <div role="alert" className="studio-warning">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : <p className="studio-valid">التباين الأساسي للنصوص مناسب لمعيار AA.</p>}
          <p className="studio-guidance">تخصيص الألوان المنشور يحتاج عقدًا خادميًا وفحص جميع الأدوار الدلالية. لن تتحول المسودة إلى ثيم التطبيقات تلقائيًا.</p>
        </div>}
        <div className="studio-inspector-footer"><span>حالة النشر: غير متصل بالخادم</span><button type="button" className="button button-primary" disabled title="النشر غير متاح حتى اكتمال صلاحيات وخدمة الاستوديو">النشر غير متاح</button></div>
      </aside>
    </div>
  </section>;
}

export function TemplateStudioWorkspace() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("marketing")) {
    return <section className="workspace-page workspace-restricted" role="alert"><h1>استوديو القالب غير متاح</h1><p>يلزم حساب مشغّل مخوّل بالتسويق لفتح المحرر.</p></section>;
  }
  return <Editor key={state.identity.subject} actorId={state.identity.subject} />;
}
