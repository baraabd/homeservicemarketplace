import { createBrowserRouter, redirect } from "react-router";
import { Root }                            from "./Root";
import { LoginPage, SignUpPage, ForgotPasswordPage } from "./pages/AuthPages";
import { HomePage }                        from "./pages/HomePage";
import { AppSelector }                     from "./pages/AppSelector";
import { ProviderPage }                    from "./pages/ProviderPage";
import { AdminPage }                       from "./pages/AdminPage";

// ─── Auth guards ──────────────────────────────────────────────────────────────
const guestOnly = () => {
  if (localStorage.getItem("fixnow_authed")) return redirect("/home");
  return null;
};

const requireAuth = () => {
  if (!localStorage.getItem("fixnow_authed")) return redirect("/login");
  return null;
};

// ─── Router ───────────────────────────────────────────────────────────────────
export const router = createBrowserRouter([
  // ── Admin (full-width, no phone container) ───────────────────────────────
  { path: "admin", Component: AdminPage },

  // ── Provider (phone container via Root) ─────────────────────────────────
  {
    path: "/",
    Component: Root,
    children: [
      // Root redirect → app selector
      { index: true, loader: () => redirect("/select") },

      // Selector
      { path: "select", Component: AppSelector },

      // ── Auth ──────────────────────────────────────────────────────────
      { path: "login",           Component: LoginPage,          loader: guestOnly },
      { path: "signup",          Component: SignUpPage,         loader: guestOnly },
      { path: "forgot-password", Component: ForgotPasswordPage, loader: guestOnly },

      // ── Seeker App ────────────────────────────────────────────────────
      { path: "home",            Component: HomePage,           loader: requireAuth },
      { path: "home/bookings",   Component: HomePage,           loader: requireAuth },
      { path: "home/messages",   Component: HomePage,           loader: requireAuth },
      { path: "home/profile",    Component: HomePage,           loader: requireAuth },

      // ── Provider App ──────────────────────────────────────────────────
      { path: "provider",        Component: ProviderPage,       loader: requireAuth },

      // ── Catch-all ─────────────────────────────────────────────────────
      { path: "*", loader: () => redirect("/select") },
    ],
  },
]);
