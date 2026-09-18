import { useEffect, useState } from "react";
import { AutoDetectProvider } from "./components/AutoProfiles";
import { ConfirmProvider } from "./components/Confirm";
import { Conversation } from "./components/Conversation";
import { ResizeHandle } from "./components/ResizeHandle";
import { SessionView } from "./components/SessionView";
import { AnalyticsDialog } from "./components/AnalyticsDialog";
import { InspectDialog } from "./components/InspectDialog";
import { SettingsDialog, type SettingsTab } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { usePersistentWidth } from "./lib/usePersistentWidth";
import { useStore } from "./lib/store";

const COLLAPSED_KEY = "review-tool:sidebar-collapsed";

export default function App() {
  const boot = useStore((state) => state.boot);
  // Null while closed; the object is where the dialog should land, for the
  // controls that open it at one page rather than at the top.
  const [settingsAt, setSettingsAt] = useState<{ tab?: SettingsTab; profileId?: string } | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both panels are draggable and remembered; the middle column takes the rest.
  // The sidebar opens wide enough for the three buttons at its foot to carry
  // their labels; dragged narrower than that they stand as icons, which is
  // ConnectionsSection's own business.
  const left = usePersistentWidth("review-tool:sidebar-width", 320, { min: 220, max: 520 });
  const right = usePersistentWidth("review-tool:chat-width", 380, { min: 280, max: 760 });

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Private windows and blocked site data: the preference just does not persist.
    }
  }, [collapsed]);

  useEffect(() => {
    boot().catch((cause: Error) => setError(cause.message));
  }, [boot]);

  return (
    <ConfirmProvider>
    <AutoDetectProvider>
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        width={left.width}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        onOpenSettings={() => setSettingsAt({})}
        onEditProfile={(profileId) => setSettingsAt({ tab: "profiles", profileId })}
        onOpenInspect={() => setInspectOpen(true)}
        onOpenAnalytics={() => setAnalyticsOpen(true)}
      />
      {!collapsed && <ResizeHandle onDrag={left.resizeBy} onReset={left.reset} />}

      <SessionView />

      <ResizeHandle onDrag={(delta) => right.resizeBy(-delta)} onReset={right.reset} />
      {/* The chat box is always available: whatever the UI cannot express, you type. */}
      <section className="flex shrink-0 flex-col border-l" style={{ width: right.width }}>
        <Conversation />
      </section>

      {settingsAt && (
        <SettingsDialog
          onClose={() => setSettingsAt(null)}
          initialTab={settingsAt.tab}
          initialProfileId={settingsAt.profileId}
        />
      )}
      {inspectOpen && <InspectDialog onClose={() => setInspectOpen(false)} />}
      {analyticsOpen && <AnalyticsDialog onClose={() => setAnalyticsOpen(false)} />}

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-destructive px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </div>
      )}
    </div>
    </AutoDetectProvider>
    </ConfirmProvider>
  );
}
