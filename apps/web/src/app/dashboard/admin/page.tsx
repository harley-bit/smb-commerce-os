export default function DashboardAdminPage() {
  return (
    <main>
      <h1>Admin</h1>
      <p>Role-gated page — reachable only by OWNER or ADMIN (enforced by src/middleware.ts + src/auth/routeRules.ts).</p>
    </main>
  );
}
