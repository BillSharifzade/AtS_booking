import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { isAdmin, loadAuth } from "./auth";
import { NotificationsProvider } from "./notifications";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import BookingsPage from "./pages/BookingsPage";
import BookingDetailPage from "./pages/BookingDetailPage";
import CoffeePage from "./pages/CoffeePage";
import RoomsPage from "./pages/RoomsPage";
import AuditPage from "./pages/AuditPage";
import BotTextsPage from "./pages/BotTextsPage";
import UsersPage from "./pages/UsersPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const loc = useLocation();
  return loadAuth() ? children : <Navigate to="/login" state={{ from: loc }} replace />;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  // Viewers (read-only) can't reach admin-only screens — bounce to the dashboard.
  return isAdmin() ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <NotificationsProvider>
              <Layout />
            </NotificationsProvider>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route path="bookings/:id" element={<BookingDetailPage />} />
        <Route path="coffee" element={<CoffeePage />} />
        <Route path="rooms" element={<RoomsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="bot-texts" element={<BotTextsPage />} />
        <Route path="users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
      </Route>
    </Routes>
  );
}
