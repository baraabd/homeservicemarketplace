import { useRootContext } from "../Root";
import { HomeScreen }     from "../components/home/HomeScreen";

// ─────────────────────────────────────────────────────────────────────────────
// HOME PAGE  /home  /home/bookings  /home/messages  /home/profile
// ─────────────────────────────────────────────────────────────────────────────
// All four tab paths render this same component. HomeScreen reads the active
// tab from the URL via useLocation internally.
// ─────────────────────────────────────────────────────────────────────────────
export function HomePage() {
  const { isOffline, openWizard, toggleOffline } = useRootContext();

  return (
    <HomeScreen
      isOffline={isOffline}
      onServiceSelect={openWizard}
      onToggleOffline={toggleOffline}
    />
  );
}
