import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import { Toaster } from "sonner";

export default function MainLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </main>
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
