import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import TitleBar from "@/components/TitleBar";
import { Toaster } from "sonner";

export default function MainLayout() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
      <TitleBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
