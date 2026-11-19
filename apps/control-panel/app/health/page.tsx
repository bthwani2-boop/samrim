import styles from "../../src/features/operator-shell/operator-shell.module.css";

export default function HealthPage() {
  return (
    <main className={styles.landing} aria-labelledby="operator-health-title">
      <h1 id="operator-health-title">حالة واجهة لوحة التحكم</h1>
      <p>واجهة لوحة التحكم متاحة. هذه الصفحة تفحص الواجهة فقط.</p>
      <a className={styles.primaryLink} href="/">فتح لوحة تحكم بثواني</a>
    </main>
  );
}
