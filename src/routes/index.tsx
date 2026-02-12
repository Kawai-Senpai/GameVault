import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainLayout from "@/layouts/MainLayout";
import Library from "@/pages/Library";
import GameDetail from "@/pages/GameDetail";
import AddGame from "@/pages/AddGame";
import Screenshots from "@/pages/Screenshots";
import KeyMapper from "@/pages/KeyMapper";
import Macros from "@/pages/Macros";
import AiChat from "@/pages/AiChat";
import Notes from "@/pages/Notes";
import Performance from "@/pages/Performance";
import Shortcuts from "@/pages/Shortcuts";
import SettingsPage from "@/pages/Settings";
import SetupWizard from "@/pages/SetupWizard";
import Overlay from "@/pages/Overlay";
import { useApp } from "@/contexts/app.context";

export default function AppRoutes() {
  const { setupComplete, isLoading } = useApp();

  // Overlay window detection — renders a separate minimal UI
  const isOverlay = window.location.pathname === "/overlay" ||
    new URLSearchParams(window.location.search).get("window") === "overlay";
  if (isOverlay) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Overlay />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!setupComplete) {
    return (
      <BrowserRouter>
        <SetupWizard />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Library />} />
          <Route path="/game/:gameId" element={<GameDetail />} />
          <Route path="/add-game" element={<AddGame />} />
          <Route path="/screenshots" element={<Screenshots />} />
          <Route path="/key-mapper" element={<KeyMapper />} />
          <Route path="/macros" element={<Macros />} />
          <Route path="/ai-chat" element={<AiChat />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/shortcuts" element={<Shortcuts />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex h-screen w-screen bg-background">
      {/* Sidebar skeleton */}
      <div className="w-56 border-r border-border p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="skeleton size-7 rounded-lg" />
          <div className="space-y-1 flex-1">
            <div className="skeleton h-3 w-20 rounded" />
            <div className="skeleton h-2 w-10 rounded" />
          </div>
        </div>
        <div className="space-y-1 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-full rounded-lg" />
          ))}
        </div>
        <div className="h-px bg-border my-2" />
        <div className="skeleton h-7 w-full rounded-lg" />
        <div className="space-y-1 pt-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2">
              <div className="skeleton size-6 rounded" />
              <div className="space-y-1 flex-1">
                <div className="skeleton h-2.5 w-24 rounded" />
                <div className="skeleton h-2 w-16 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-5 space-y-4">
        <div className="skeleton h-4 w-32 rounded" />
        <div className="skeleton h-3 w-48 rounded" />
        <div className="grid grid-cols-3 gap-4 pt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton aspect-3/4 w-full rounded-xl" />
              <div className="skeleton h-3 w-3/4 rounded" />
              <div className="skeleton h-2 w-1/2 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
