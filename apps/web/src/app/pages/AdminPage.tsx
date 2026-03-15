import { LanguageProvider } from "../i18n/LanguageContext";
import { EcosystemProvider } from "../context/EcosystemContext";
import { AdminDashboard }    from "../components/admin/AdminDashboard";

export function AdminPage() {
  return (
    <LanguageProvider>
      <EcosystemProvider>
        <AdminDashboard />
      </EcosystemProvider>
    </LanguageProvider>
  );
}
