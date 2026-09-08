export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <p>Protected page — reachable only with a valid session (enforced by src/middleware.ts).</p>
    </main>
  );
}
