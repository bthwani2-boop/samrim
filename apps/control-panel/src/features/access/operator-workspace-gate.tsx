// Identity does not yet issue a complete authenticated Operator browser session.
// Render no workspace children, navigation, metrics or private data in its absence.
export default function OperatorWorkspaceGate() {
  return (
    <main style={{ maxWidth: 760, margin: "5rem auto", padding: 24 }}>
      <h1>لوحة تحكم بثواني</h1>
      <p role="alert">الوصول إلى هذه المساحة غير متاح: جلسة المشغّل غير متحققة أو صلاحيتها الحالية غير كافية لدى Identity.</p>
      <p>لا تكفي عضوية Operator وحدها لمنح صلاحية إدارة العمليات أو المالية أو السياسات.</p>
    </main>
  );
}
