"use client";

import { ConfigProvider, Tabs } from "antd";
import type { ReactNode } from "react";
import "./command-surface.css";

export type CommandMetric = Readonly<{
  id: string;
  label: string;
  value: number | null;
  description: string;
  tone?: "normal" | "danger" | "warning" | "success";
  action?: () => void;
}>;

export type CommandMeasure = Readonly<{ id: string; label: string; value: number; tone?: "normal" | "danger" | "warning" | "success" }>;

const format = (value: number) => new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 0 }).format(value);

export function CommandMetricStrip({ metrics }: Readonly<{ metrics: readonly CommandMetric[] }>) {
  return <div className="bt-command-metrics">
    {metrics.map(metric => {
      const content = <><span className="bt-command-metric-name">{metric.label}</span>
        <strong className="bt-command-metric-value" dir="auto">{metric.value === null ? "—" : format(metric.value)}</strong>
        <small className="bt-command-metric-note">{metric.description}</small></>;
      return metric.action
        ? <button key={metric.id} type="button" className="bt-command-metric" data-tone={metric.tone ?? "normal"} onClick={metric.action}>{content}</button>
        : <div key={metric.id} className="bt-command-metric" data-tone={metric.tone ?? "normal"}>{content}</div>;
    })}
  </div>;
}

export function CommandBarPanel({ title, subtitle, measures, total }: Readonly<{
  title: string; subtitle: string; measures: readonly CommandMeasure[]; total?: number | null;
}>) {
  const max = Math.max(1, total ?? 0, ...measures.map(row => row.value));
  return <section className="bt-command-panel" aria-label={title}>
    <div className="bt-command-panel-head"><h2>{title}</h2><span>{subtitle}</span></div>
    {measures.length ? <div className="bt-command-bars">{measures.map(row =>
      <div className="bt-command-bar-row" key={row.id}>
        <span className="bt-command-bar-label">{row.label}</span>
        <div className="bt-command-bar-track">
          <span className="bt-command-bar-fill" data-tone={row.tone ?? "normal"} style={{ width: Math.min(100, Math.max(0, row.value / max * 100)) + "%" }} />
        </div>
        <strong className="bt-command-bar-value" dir="ltr">{format(row.value)}</strong>
      </div>
    )}</div> : <p className="bt-command-empty">لا توجد بيانات مؤرخة كافية لعرض هذا التحليل.</p>}
  </section>;
}

export type CommandEvent = Readonly<{ id: string; title: string; description: string; date?: string; tone?: "normal" | "danger" | "warning" | "success"; action: () => void }>;

export function CommandDecisionList({ title, items, footer }: Readonly<{ title: string; items: readonly CommandEvent[]; footer?: ReactNode }>) {
  return <section className="bt-command-panel bt-command-decision-panel" aria-label={title}>
    <div className="bt-command-panel-head"><h2>{title}</h2><small>{items.length ? "من السجلات المعروضة" : "لا توجد حالات معروضة"}</small></div>
    {items.length ? <ul className="bt-command-decisions">{items.map(item =>
      <li key={item.id}><button type="button" onClick={item.action}>
        <span className="bt-command-decision-dot" data-tone={item.tone ?? "normal"} aria-hidden="true"/>
        <span className="bt-command-decision-content"><strong>{item.title}</strong><small>{item.description}</small></span>
        <span className="bt-command-decision-action" aria-hidden="true">←</span>
      </button></li>)}</ul> :
      <div className="bt-command-empty">لا توجد قرارات ضمن السجلات المحمّلة. افتح السجل الكامل للتحقق من جميع الحالات.</div>}
    {footer ? <div className="bt-command-panel-foot">{footer}</div> : null}
  </section>;
}

export function CommandSectionTabs<T extends string>({ label, active, tabs, onSelect }: Readonly<{
  label: string; active: T; tabs: readonly Readonly<{id:T; label:string}>[]; onSelect: (next:T) => void;
}>) {
  return <nav className="bt-command-nav" aria-label={label}>
    <ConfigProvider theme={{ components: { Tabs: {
      itemColor: "var(--btc-text)",
      itemHoverColor: "var(--btc-orange)",
      itemSelectedColor: "var(--btc-orange)",
      inkBarColor: "var(--btc-orange)",
    } } }}>
      <Tabs
        className="bt-command-section-tabs"
        activeKey={active}
        items={tabs.map(tab => ({ key: tab.id, label: tab.label }))}
        onChange={(key) => {
          const chosen = tabs.find(tab => tab.id === key);
          if (chosen) onSelect(chosen.id);
        }}
        animated={false}
        size="large"
        tabBarGutter={12}
      />
    </ConfigProvider>
  </nav>;
}

export function CommandFrame({ title, subtitle, right, children }: Readonly<{ title:string; subtitle:string; right?:ReactNode; children:ReactNode }>) {
  return <div className="bt-command-frame" dir="rtl">
    <header className="bt-command-heading"><div className="bt-command-identity"><div className="bt-command-mark" aria-hidden="true"><i/><i/><i/></div><div><h1>{title}</h1><p>{subtitle}</p></div></div>{right}</header>
    {children}
  </div>;
}
