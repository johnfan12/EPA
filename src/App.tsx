import { Beaker, Bot, FileText, MessageSquareText, Moon, Settings, Sun, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EmptyState } from "./components/EmptyState";
import { HomeView } from "./components/HomeView";
import { useIdeaChildren } from "./hooks/useIdeaChildren";
import { DiscussionTab } from "./tabs/DiscussionTab";
import { AgentTab } from "./tabs/AgentTab";
import { ExperimentsTab } from "./tabs/ExperimentsTab";
import { ReportsTab } from "./tabs/ReportsTab";
import { Sidebar } from "./panels/Sidebar";
import { RightRail } from "./panels/RightRail";
import { SettingsDialog } from "./panels/SettingsDialog";
import { useWorkspaceStore } from "./store";
import type { TabProps } from "./lib/types";

const tabs = [
  { id: "discussion", label: "讨论与演化", icon: MessageSquareText },
  { id: "agents", label: "Agent 沟通", icon: Bot },
  { id: "experiments", label: "实验数据", icon: Beaker },
  { id: "reports", label: "实验报告", icon: FileText },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const theme = useWorkspaceStore((state) => state.theme);
  const toggleTheme = useWorkspaceStore((state) => state.toggleTheme);
  const view = useWorkspaceStore((state) => state.view);
  const setView = useWorkspaceStore((state) => state.setView);
  const selectedIdeaId = useWorkspaceStore((state) => state.selectedIdeaId);
  const setSelectedIdeaId = useWorkspaceStore((state) => state.setSelectedIdeaId);
  const activeTab = useWorkspaceStore((state) => state.activeTab);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const settingsOpen = useWorkspaceStore((state) => state.settingsOpen);
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsOpen);
  const apiKeyByProvider = useWorkspaceStore((state) => state.apiKeyByProvider);
  const setApiKey = useWorkspaceStore((state) => state.setApiKey);

  const ideasQuery = useQuery({
    queryKey: ["ideas", search],
    queryFn: () => api.listIdeas(search),
  });

  const settingsQuery = useQuery({
    queryKey: ["provider-settings"],
    queryFn: api.getProviderSettings,
  });

  const ideas = ideasQuery.data ?? [];
  const selectedIdea = ideas.find((idea) => idea.id === selectedIdeaId) ?? ideas[0] ?? null;
  const children = useIdeaChildren(selectedIdea?.id ?? null);
  const providerSettings = settingsQuery.data ?? { provider: "openai", model: "gpt-4.1", apiEndpoint: "" };
  const apiKey = apiKeyByProvider[providerSettings.provider] ?? "";

  useEffect(() => {
    if (!selectedIdea && ideas.length > 0) {
      setSelectedIdeaId(ideas[0].id);
    }
  }, [ideas, selectedIdea, setSelectedIdeaId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  // Load the saved API key for the active provider from the OS credential store.
  const provider = providerSettings.provider;
  const hasKey = Boolean(apiKeyByProvider[provider]);
  useEffect(() => {
    if (!provider || hasKey) return;
    let active = true;
    api
      .loadApiKey(provider)
      .then((key) => {
        if (active && key) setApiKey(provider, key);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [provider, hasKey, setApiKey]);

  const deleteIdea = useMutation({
    mutationFn: api.deleteIdea,
    onSuccess: async () => {
      setSelectedIdeaId(null);
      setView("home");
      await queryClient.invalidateQueries({ queryKey: ["ideas"] });
      setNotice("Idea 已归档删除。");
    },
  });

  // Selecting an idea (sidebar, search hit, home agent button) enters its workspace.
  const openIdea = (id: number) => {
    setSelectedIdeaId(id);
    setView("workspace");
  };

  return (
    <main className={view === "home" ? "app-shell home" : "app-shell"}>
      <Sidebar
        ideas={ideas}
        selectedIdeaId={view === "workspace" ? selectedIdea?.id ?? null : null}
        homeActive={view === "home"}
        search={search}
        setSearch={setSearch}
        onSelect={openIdea}
        onGoHome={() => setView("home")}
      />

      {view === "home" ? (
        <HomeView providerSettings={providerSettings} apiKey={apiKey} onOpenIdea={openIdea} />
      ) : (
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local-first research workspace</p>
            <h1>{selectedIdea?.title ?? "科研 Idea Agent"}</h1>
          </div>
          <div className="button-row">
            <button
              className="icon-button subtle"
              title={theme === "dark" ? "切换到浅色" : "切换到深色"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {selectedIdea ? (
              <button
                className="icon-button subtle"
                title="删除当前 Idea"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} />
              </button>
            ) : null}
            <button className="icon-button" title="模型设置" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
              <span>设置</span>
            </button>
          </div>
        </header>

        {selectedIdea ? (
          <>
            <nav className="tabs" aria-label="Idea sections">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    className={activeTab === tab.id ? "tab active" : "tab"}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            <IdeaTab
              tab={activeTab as TabId}
              idea={selectedIdea}
              providerSettings={providerSettings}
              apiKey={apiKey}
              setNotice={setNotice}
            />
          </>
        ) : (
          <EmptyState
            icon={<MessageSquareText size={34} />}
            title="创建第一个 Idea 后开始整理"
            message="左侧新建一个研究想法，然后粘贴讨论、生成外部 Agent prompt、汇总实验和报告。"
          />
        )}
      </section>
      )}

      {view === "workspace" ? <RightRail idea={selectedIdea} {...children} /> : null}

      {settingsOpen ? (
        <SettingsDialog
          settings={providerSettings}
          onClose={() => setSettingsOpen(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ["provider-settings"] });
            setNotice("设置已保存。");
          }}
        />
      ) : null}

      {confirmDelete && selectedIdea ? (
        <ConfirmDialog
          title="删除 Idea"
          message={`确定删除「${selectedIdea.title}」？该 idea 下的讨论、实验、报告等记录都会一并删除，且不可恢复。`}
          confirmLabel="删除"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            deleteIdea.mutate(selectedIdea.id);
            setConfirmDelete(false);
          }}
        />
      ) : null}

      {notice ? <div className="toast">{notice}</div> : null}
    </main>
  );
}

function IdeaTab({ tab, ...props }: TabProps & { tab: TabId }) {
  if (tab === "discussion") return <DiscussionTab {...props} />;
  if (tab === "agents") return <AgentTab {...props} />;
  if (tab === "experiments") return <ExperimentsTab {...props} />;
  return <ReportsTab {...props} />;
}
