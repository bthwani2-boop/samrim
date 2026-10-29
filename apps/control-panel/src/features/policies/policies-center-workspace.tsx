"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { CommandFrame, CommandMetricStrip, CommandSectionTabs } from "../shared/command-surface";
import { OperationalIcon } from "../../shell/workspace-icon";
import { PoliciesWorkspace } from "./policies-workspace";
import { canManagePolicy, isPolicyKey, type PolicyResourceKey, policyCapabilities as policies, policyCapability } from "./policy-capabilities";
import { policyEditors } from "./policy-editors";
import { readFinancialPolicyPreviews } from "./policy-financial-preview";
import { type PolicyPreviewState, PolicyQuickPeek } from "./policy-quick-peek";

type DrawerMode = "manage" | "add" | "choose";
type PolicyGroup = "all" | "delivery" | "wallets" | "scope";
const policyGroups:ReadonlyArray<{id:PolicyGroup;label:string}> = [
  {id:"all",label:"السياسات العامة"},{id:"delivery",label:"التوصيل والرسوم"},
  {id:"wallets",label:"المحافظ والمستحقات"},{id:"scope",label:"نطاق الخدمة"},
];
function matchesPolicyGroup(key: PolicyResourceKey, group:PolicyGroup) {
  if(group==="all")return true;
  if(group==="delivery")return ["delivery-fees","store-type-cancellation"].includes(key);
  if(group==="wallets")return ["wallet-providers","captain-minimum-balance","partner-financial-terms"].includes(key);
  return key==="service-cities";
}

function describePreview(preview: PolicyPreviewState | undefined): string {
  if (!preview || preview.kind === "loading") return "جارٍ قراءة السجلات…";
  if (preview.kind === "error") return "تعذرت قراءة الملخص";
  if (preview.kind === "restricted") return "تتطلب صلاحية المالية";
  if (preview.kind === "missing") return "لم تُفعّل سياسة بعد";
  if (!preview.value) return "لا تتوفر قراءة مؤكدة";
  if (preview.value.headline) return preview.value.headline;
  const names=preview.value.records.slice(0,2).map((item)=>item.name).join("، ");
  return `${preview.value.active ?? 0} نشطة · ${preview.value.inactive ?? 0} متوقفة${names ? ` · ${names}` : ""}`;
}

export function PoliciesCenterWorkspace() {
  const { state } = useSession();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<PolicyGroup>("all");
  const [selected, setSelected] = useState<PolicyResourceKey | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("choose");
  const [visited, setVisited] = useState<ReadonlyArray<PolicyResourceKey>>([]);
  const [previews, setPreviews] = useState<Partial<Record<PolicyResourceKey, PolicyPreviewState>>>({});
  const [peekKey, setPeekKey] = useState<PolicyResourceKey | null>(null);
  const [peekStyle, setPeekStyle] = useState<CSSProperties>({});
  const peekRef = useRef<HTMLDivElement>(null);
  const peekButtonRef = useRef<HTMLButtonElement | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const managementCloseButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  const identity = state.kind === "authenticated" ? state.identity : null;
  const canRead = identity?.role === "operator";
  const canReadFinance = identity?.permissions?.includes("finance") === true;

  useEffect(() => {
    if (!canRead) return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("policy");
    const requestedGroup = params.get("group");
    if(policyGroups.some(tab=>tab.id===requestedGroup))setGroup(requestedGroup as PolicyGroup);
    if (isPolicyKey(fromUrl)) {
      const canModify = canManagePolicy(fromUrl, identity?.permissions);
      setSelected(canModify ? fromUrl : null);
      setDrawerMode("manage");
      setDrawerOpen(canModify);
    }
  }, [canRead, identity?.permissions]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (drawerOpen) {
      if (!dialog.open) dialog.showModal();
      closeButtonRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
    }
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    if (drawerMode === "choose") managementCloseButtonRef.current?.focus();
  }, [drawerOpen, drawerMode]);

  useEffect(() => {
    if (!canRead) return;
    if (previewRevision > 0) {
      setPreviews((current) => ({ ...current, "service-cities": { kind: "loading" }, "wallet-providers": { kind: "loading" } }));
    }
    const controller = new AbortController();
    const sources = policies.filter((item) => item.list !== null);
    for (const { key, list } of sources) {
      const { path: url, collection } = list;
      void (async () => {
        try {
          const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
          if (!response.ok) throw new Error("read");
          const payload = await response.json() as Record<string, unknown>;
          const records = payload[collection];
          if (!Array.isArray(records)) throw new Error("shape");
          const validRecords = records as ReadonlyArray<{ active: boolean; displayNameAr: string; id?: string; key?: string; updatedAt?: string; version?: number }>;
          if (!validRecords.every((item) => typeof item.active === "boolean" && typeof item.displayNameAr === "string" && (typeof item.id === "string" || typeof item.key === "string"))) throw new Error("shape");
          if (controller.signal.aborted) return;
          setPreviews((current) => ({ ...current, [key]: {
            kind: "ready",
            value: {
              active: validRecords.filter((item) => item.active).length,
              inactive: validRecords.filter((item) => !item.active).length,
              records: validRecords.slice(0, 5).map((item) => ({ id: item.id ?? item.key!, name: item.displayNameAr, active: item.active, updatedAt: item.updatedAt, version: item.version })),
            },
          } }));
        } catch {
          if (!controller.signal.aborted) setPreviews((current) => ({ ...current, [key]: { kind: "error" } }));
        }
      })();
    }
    return () => controller.abort();
  }, [canRead, previewRevision]);

  useEffect(() => {
    if (!canRead) return;
    const controller=new AbortController();
    setPreviews(current=>({...current,
      "delivery-fees":{kind:"loading"},
      "partner-financial-terms":{kind:"loading"},"captain-minimum-balance":{kind:"loading"}
    }));
    if (previewRevision < 0) return; // The revision intentionally forces a canonical policy refetch.
    void readFinancialPolicyPreviews(controller.signal,canReadFinance).then(next=>{
      if(!controller.signal.aborted)setPreviews(current=>({...current,...next}));
    });
    return ()=>controller.abort();
  },[canRead,previewRevision,canReadFinance]);

  useEffect(()=>{
    const refresh=()=>setPreviewRevision(v=>v+1);
    window.addEventListener("policy:changed",refresh);
    return ()=>window.removeEventListener("policy:changed",refresh);
  },[]);

  useEffect(() => {
    if (!selected || drawerMode === "choose") return;
    setVisited((current) => current.includes(selected) ? current : [...current, selected]);
  }, [selected, drawerMode]);

  useEffect(() => {
    if (!selected || drawerMode !== "add" || !visited.includes(selected)) return;
    const container = dialogRef.current?.querySelector(`[data-policy-editor="${selected}"]`);
    const disclosure = container?.querySelector("details.create-disclosure");
    if (disclosure instanceof HTMLDetailsElement) {
      disclosure.open = true;
      disclosure.querySelector("input")?.focus();
    }
  }, [selected, drawerMode, visited]);

  useEffect(() => {
    if (!peekKey) return;
    peekRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPeekKey(null);
        peekButtonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (peekRef.current?.contains(target) || peekButtonRef.current?.contains(target))) return;
      setPeekKey(null);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && peekRef.current?.contains(event.target)) return;
      setPeekKey(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [peekKey]);

  if (state.kind !== "authenticated") return null;
  if (!canRead) return <section className="state-content workspace-restricted" role="alert">
    <h1>سياسات المنصة للمشغلين فقط</h1>
    <p>لا تمنح هذه الصفحة صلاحيات إضافية.</p>
  </section>;

  const canEdit = (key: PolicyResourceKey) => canManagePolicy(key, identity.permissions);
  const visible = policies.filter((item) => {
    if(!matchesPolicyGroup(item.key,group))return false;
    const searchText = `${item.label} ${item.description} ${item.context} ${item.summary} ${item.scope}`;
    return searchText.toLocaleLowerCase("ar").includes(query.trim().toLocaleLowerCase("ar"));
  });
  const active = policies.find((item) => item.key === selected);
  const activeMeta = active ?? null;

  function closeDrawer() {
    if (drawerMode === "manage" || drawerMode === "add") setPreviewRevision((value) => value + 1);
    setDrawerOpen(false);
    setDrawerMode("choose");
    const url = new URL(window.location.href);
    url.searchParams.delete("policy");
    url.searchParams.delete("action");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function closePeek() {
    setPeekKey(null);
    peekButtonRef.current?.focus();
  }

  function openPeek(key: PolicyResourceKey, button: HTMLButtonElement) {
    if (peekKey === key) {
      closePeek();
      return;
    }
    peekButtonRef.current = button;
    const bounds = button.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 24);
    // Use viewport positioning so the preview remains anchored without reflowing the registry.
    const left = Math.max(12, Math.min(bounds.left - width + bounds.width, window.innerWidth - width - 12));
    const maxHeight = Math.min(410, window.innerHeight - 24);
    const top = Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - maxHeight - 12));
    setPeekStyle({ left, top, width });
    setPeekKey(key);
  }

  function openEditor(key: PolicyResourceKey, button?: HTMLButtonElement) {
    if (!canEdit(key)) return;
    if (button) returnFocusRef.current = button;
    setPeekKey(null);
    setSelected(key);
    setDrawerMode("manage");
    setDrawerOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set("policy", key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function openPolicyManagement(element?: HTMLButtonElement) {
    setPeekKey(null);
    if (element) returnFocusRef.current = element;
    if (selected && !canEdit(selected)) setSelected(null);
    setDrawerMode("choose");
    setDrawerOpen(true);
  }

  function chooseManagementAction(action: "manage" | "add") {
    if (!selected || !canEdit(selected)) return;
    setDrawerMode(action);
  }

  return <section className="workspace-page policy-studio" aria-label="سياسات المنصة" data-testid="policy-studio">
    <CommandFrame title="السياسات" subtitle="ضبط السياسات التشغيلية والمالية ونطاق الخدمة من مصدرها المعتمد">
      <CommandSectionTabs label="مجموعات السياسات" active={group} tabs={policyGroups} onSelect={next=>{
        setGroup(next);setPeekKey(null);setQuery("");
        const url=new URL(window.location.href);
        if(next==="all")url.searchParams.delete("group");else url.searchParams.set("group",next);
        window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
      }}/>
      {group==="all"?<CommandMetricStrip metrics={[
        {id:"supported",label:"أنواع السياسات المدعومة",value:policies.length,description:"عدد أنواع الإعدادات، لا عدد القواعد النشطة"},
        {id:"modifiable",label:"متاحة للتعديل",value:policies.filter(item=>canEdit(item.key)).length,description:"وفق صلاحيات المشغّل",tone:"success"},
        {id:"readonly",label:"قراءة فقط",value:policies.filter(item=>!canEdit(item.key)).length,description:"صلاحية تعديل غير ممنوحة",tone:"warning"},
        {id:"financial",label:"قيود مالية إضافية",value:policies.filter(item=>item.additionalPermission==="finance").length,description:"أنواع تتطلب صلاحية المالية"},
      ]}/> : null}
    <div className="policy-rich-toolbar">
      <p className="muted">السياسات المعتمدة وأهم معلوماتها. اختر الصف للمراجعة أو التنفيذ.</p>
      {policies.length > 8 ? <label className="policy-rich-search">
        <span className="visually-hidden">البحث في السياسات</span>
        <input type="search" value={query} placeholder="بحث سريع عن سياسة…" autoComplete="off"
          onChange={(event) => setQuery(event.target.value)} />
      </label> : null}
      {identity.permissions?.includes("platform_policies") ? <><a href="/policies/stage-sla" className="button">مهل مراحل الطلب</a><button type="button" className="button button-primary" onClick={(event) => openPolicyManagement(event.currentTarget)}>إدارة سياسة</button></> : null}
    </div>
    <ul className="policy-rich-list" aria-label="سجل سياسات المنصة">
      {visible.map((item) => {
        const itemPreview = previews[item.key];
        return <li key={item.key} className="policy-rich-item">
          <div className="policy-rich-row">
            <span className="policy-rich-identity">
              <span className="policy-rich-icon"><OperationalIcon name={item.icon} /></span>
              <span className="policy-rich-name"><strong>{item.label}</strong><small>{item.summary}</small></span>
            </span>
            <span className="policy-rich-facts">
              <span className="policy-rich-context">{item.context}</span>
              <span className={`policy-rich-measure ${itemPreview?.kind === "error" ? "is-unavailable" : ""}`}>
                {describePreview(itemPreview)}
              </span>
            </span>
            <span className="policy-rich-row-actions">
              <button type="button" className="policy-rich-icon-action" aria-label={`معاينة ${item.label}`}
                aria-expanded={peekKey === item.key} aria-haspopup="dialog"
                onClick={(event) => openPeek(item.key, event.currentTarget)}>
                <OperationalIcon name="eye" />
              </button>
              {canEdit(item.key) ? <button type="button" className="policy-rich-icon-action" aria-label={`تعديل ${item.label}`}
                onClick={(event) => openEditor(item.key, event.currentTarget)}>
                <OperationalIcon name="edit" />
              </button> : <span className="policy-rich-readonly" title="قراءة فقط">قراءة فقط</span>}
            </span>
          </div>
        </li>;
      })}
      {!visible.length ? <li className="policy-rich-empty" role="status">لا توجد سياسة تطابق البحث.</li> : null}
    </ul>
    {peekKey ? <PolicyQuickPeek policy={policyCapability(peekKey)} preview={previews[peekKey]}
      position={peekStyle} containerRef={peekRef} onClose={() => closePeek()}
      /> : null}

    <dialog ref={dialogRef} className="policy-rich-drawer workspace-side-drawer" aria-labelledby={drawerMode === "choose" ? "policy-manage-drawer-title" : "policy-rich-drawer-title"}
      onKeyDownCapture={(event) => { if (event.key === "Escape" && event.target instanceof HTMLElement && event.target.matches("input, textarea, select")) event.preventDefault(); }}
      onCancel={(event) => { event.preventDefault(); closeDrawer(); }}>
      {drawerMode === "choose" ? <>
        <header className="policy-rich-drawer-header workspace-side-drawer-header">
          <button ref={managementCloseButtonRef} type="button" className="policy-rich-close" aria-label="إغلاق إدارة السياسات" onClick={closeDrawer}>×</button>
          <div className="policy-rich-drawer-heading"><span className="policy-rich-icon"><OperationalIcon name="policies" /></span><h2 id="policy-manage-drawer-title">إدارة سياسة</h2></div>
        </header>
        <div className="policy-rich-drawer-scroll workspace-side-drawer-scroll policy-manage-chooser">
          <label className="field-label" htmlFor="policy-manage-target">السياسة المعتمدة
            <select id="policy-manage-target" value={selected ?? ""} onChange={(event) => { const key = event.target.value; setSelected(isPolicyKey(key) ? key : null); }}>
              <option value="">اختر السياسة المطلوبة</option>
              {policies.filter((item) => canEdit(item.key)).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          {selected && canEdit(selected) ? <p className="muted">{policyCapability(selected).summary}</p> : null}
          <div className="policy-rich-primary-actions">
            <button type="button" className="button button-primary" disabled={!selected || !canEdit(selected)} onClick={() => chooseManagementAction("manage")}>تعديل سياسة موجودة</button>
            <button type="button" className="button button-secondary" disabled={!selected || !canEdit(selected)} onClick={() => chooseManagementAction("add")}>إضافة سياسة أو قاعدة</button>
          </div>
          <p className="policy-rich-note">المتاح هنا: إنشاء سجل أو إصدار في نوع تدعمه الخدمات. إنشاء نوع جديد يتطلب وجود عقد وطريقة تطبيق معتمدة، ولا يضاف كإعداد شكلي.</p>
        </div>
      </> : null}
      {active && activeMeta ? <div className="policy-rich-content" hidden={drawerMode === "choose"}>
        <header className="policy-rich-drawer-header workspace-side-drawer-header">
          <button ref={closeButtonRef} type="button" className="policy-rich-close" aria-label="إغلاق تفاصيل السياسة" onClick={closeDrawer}>×</button>
          <div className="policy-rich-drawer-heading">
            <span className="policy-rich-icon"><OperationalIcon name={activeMeta.icon} /></span>
            <div><h2 id="policy-rich-drawer-title">{active.label}</h2><p>{activeMeta.context}</p></div>
          </div>
        </header>
        <div className="policy-rich-drawer-scroll workspace-side-drawer-scroll">
            <div className="policy-rich-edit-toolbar">
              <button type="button" className="button button-secondary" onClick={() => { setDrawerMode("choose"); setPreviewRevision((value) => value + 1); }}>اختيار إجراء آخر</button>
              <strong>{drawerMode === "add" ? (activeMeta.createLabel ?? "إضافة قاعدة أو إصدار") : "تعديل السياسة"}</strong>
            </div>
          <div className="policy-rich-editor-host">
            {visited.map((key) => {
              const Editor = policyEditors[key];
              return <div key={key} data-policy-editor={key} hidden={selected !== key}>
                <PoliciesWorkspace resource={key}><Editor /></PoliciesWorkspace>
              </div>;
            })}
          </div>
        </div>
      </div> : null}
    </dialog>
    </CommandFrame>
  </section>;
}
