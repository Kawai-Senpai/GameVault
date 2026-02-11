import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import TitleBar from "@/components/TitleBar";
import { Toaster } from "sonner";

export default function MainLayout() {
  return (
    <div className="flex h-screen w-screen min-h-0 flex-col overflow-hidden rounded-lg bg-background border border-border/40">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(110%_90%_at_100%_0%,rgb(255_72_72_/_0.06),transparent_55%)]">
          <Outlet />
        </main>
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "text-xs",
          style: {
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          },
        }}
        richColors
        closeButton
      />
    </div>
  );
}
