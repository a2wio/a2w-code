"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Chat, InfraPlan, Message, ProviderConnection, Workspace } from "@/lib/types";
import { AppLogo } from "./AppLogo";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { SettingsPanel } from "./SettingsPanel";

const navItems = [
  { id: "credentials", label: "Credentials", icon: "fa-key" },
  { id: "settings", label: "Settings", icon: "fa-gear" }
] as const;
const CHAT_UPSERT_EVENT = "a2w:chat-upsert";
const CHAT_DELETE_EVENT = "a2w:chat-delete";

type ChatThread = {
  id: string;
  title: string;
};
type ShellModal = "credentials" | "settings" | null;
type PublicUser = {
  name: string;
  email: string;
};

export function DashboardShell({
  user,
  workspace,
  connections,
  applyRuntimeEnabled,
  agentBackend,
  chats,
  messages,
  plans,
  children
}: {
  user: PublicUser;
  workspace: Workspace;
  connections: ProviderConnection[];
  applyRuntimeEnabled: boolean;
  agentBackend: "mock" | "codex";
  chats: Chat[];
  messages: Message[];
  plans: InfraPlan[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [modal, setModal] = useState<ShellModal>(null);
  const [savingChatId, setSavingChatId] = useState<string | null>(null);
  const [chatList, setChatList] = useState(chats);
  const threads = buildChatThreads(chatList);
  const latestThread = threads[0];
  const activeChatId = searchParams.get("chat") || latestThread?.id || "new";
  const isChat = pathname === "/dashboard/agent";
  const isFiles = pathname === "/dashboard/files";
  const newChatActive = isChat && activeChatId === "new";
  const homeHref = latestThread ? `/dashboard/agent?chat=${encodeURIComponent(latestThread.id)}` : "/dashboard/agent?chat=new";

  useEffect(() => {
    setChatList(chats);
  }, [chats]);

  useEffect(() => {
    function handleChatUpsert(event: Event) {
      const chat = (event as CustomEvent<Chat>).detail;
      if (!chat?.id) return;
      setChatList((current) => current.some((item) => item.id === chat.id)
        ? current.map((item) => item.id === chat.id ? chat : item)
        : [chat, ...current]);
    }

    function handleChatDelete(event: Event) {
      const chatId = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!chatId) return;
      setChatList((current) => current.filter((chat) => chat.id !== chatId));
    }

    window.addEventListener(CHAT_UPSERT_EVENT, handleChatUpsert);
    window.addEventListener(CHAT_DELETE_EVENT, handleChatDelete);
    return () => {
      window.removeEventListener(CHAT_UPSERT_EVENT, handleChatUpsert);
      window.removeEventListener(CHAT_DELETE_EVENT, handleChatDelete);
    };
  }, []);

  async function renameChat(chatId: string, title: string) {
    setSavingChatId(chatId);
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not rename chat.");
      if (data.chat) {
        setChatList((current) => current.some((item) => item.id === data.chat.id)
          ? current.map((item) => item.id === data.chat.id ? data.chat : item)
          : [data.chat, ...current]);
        window.dispatchEvent(new CustomEvent(CHAT_UPSERT_EVENT, { detail: data.chat }));
      }
      router.refresh();
    } finally {
      setSavingChatId(null);
    }
  }

  async function deleteChat(chatId: string) {
    setSavingChatId(chatId);
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete chat.");
      setChatList((current) => current.filter((chat) => chat.id !== chatId));
      window.dispatchEvent(new CustomEvent(CHAT_DELETE_EVENT, { detail: { id: chatId } }));
      if (isChat && activeChatId === chatId) {
        const nextThread = threads.find((thread) => thread.id !== chatId);
        router.replace(nextThread ? `/dashboard/agent?chat=${encodeURIComponent(nextThread.id)}` : "/dashboard/agent?chat=new");
      }
      router.refresh();
    } finally {
      setSavingChatId(null);
    }
  }

  return (
    <main className="h-full overflow-hidden border border-gray-200 bg-white text-black">
      <div className="flex h-full">
        <aside
          className="group/sidebar relative z-40 h-full w-16 shrink-0"
          onMouseEnter={() => setNavigationOpen(true)}
          onMouseLeave={() => setNavigationOpen(false)}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setNavigationOpen(false);
            }
          }}
        >
          <CompactSidebar
            workspace={workspace}
            threads={threads}
            activeChatId={activeChatId}
            isChat={isChat}
            newChatActive={newChatActive}
            activeModal={modal}
            onOpen={() => setNavigationOpen((current) => !current)}
            onOpenModal={(nextModal) => {
              setModal(nextModal);
              setNavigationOpen(false);
            }}
          />
          <div
            className={`absolute inset-y-0 left-0 z-50 w-72 transition duration-150 ${
              navigationOpen ? "pointer-events-auto translate-x-0 opacity-100" : "pointer-events-none -translate-x-2 opacity-0"
            }`}
            onFocus={() => setNavigationOpen(true)}
          >
            <ExpandedSidebar
              workspace={workspace}
              threads={threads}
              activeChatId={activeChatId}
              isChat={isChat}
              newChatActive={newChatActive}
              homeHref={homeHref}
              activeModal={modal}
              savingChatId={savingChatId}
              onRenameChat={renameChat}
              onDeleteChat={deleteChat}
              onOpenModal={(nextModal) => {
                setModal(nextModal);
                setNavigationOpen(false);
              }}
              onNavigate={() => setNavigationOpen(false)}
            />
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-hidden">
          {isChat ? (
            children
          ) : isFiles ? (
            <div className="h-full overflow-hidden bg-white">{children}</div>
          ) : (
            <div className="h-full overflow-auto bg-[#f7f7f4] p-5 lg:p-6">{children}</div>
          )}
        </section>
      </div>

      {modal ? (
        <Modal
          title={modal === "credentials" ? "Credentials" : "Settings"}
          description={modal === "credentials" ? "Configure and test the cloud provider trust used by Terraform." : "Configure local execution, Codex defaults, workspace details, and session controls."}
          icon={modal === "credentials" ? "fa-key" : "fa-gear"}
          size="xl"
          onClose={() => setModal(null)}
        >
          <SettingsPanel
            user={user}
            workspace={workspace}
            connections={connections}
            applyRuntimeEnabled={applyRuntimeEnabled}
            agentBackend={agentBackend}
            mode={modal}
            embedded
          />
        </Modal>
      ) : null}
    </main>
  );
}

function CompactSidebar({
  workspace,
  threads,
  activeChatId,
  isChat,
  newChatActive,
  activeModal,
  onOpen,
  onOpenModal
}: {
  workspace: Workspace;
  threads: ChatThread[];
  activeChatId: string;
  isChat: boolean;
  newChatActive: boolean;
  activeModal: ShellModal;
  onOpen: () => void;
  onOpenModal: (modal: Exclude<ShellModal, null>) => void;
}) {
  return (
    <div className="flex h-full flex-col border-r border-gray-200 bg-[#f7f7f4]">
      <div className="grid h-[65px] shrink-0 place-items-center border-b border-gray-200">
        <button
          type="button"
          onClick={onOpen}
          className="grid h-10 w-10 place-items-center rounded-2xl bg-[#5c4ee5] text-[11px] font-semibold text-white transition hover:bg-[#4f43c7]"
          aria-label={`Open ${workspace.companyName} navigation`}
          title="Open navigation"
        >
          <AppLogo decorative className="h-10 w-10" />
        </button>
      </div>

      <div className="border-b border-gray-200 p-2">
        <Link
          href="/dashboard/agent?chat=new"
          className={`grid h-11 w-full place-items-center rounded-xl text-sm transition ${
            newChatActive ? "bg-[#eeeeec] text-neutral-950" : "text-gray-500 hover:bg-neutral-100 hover:text-black"
          }`}
          aria-label="New chat"
          title="New chat"
        >
          <Icon name="fa-plus" />
        </Link>
      </div>

      <div className="sidebar-scrollbar min-h-0 flex-1 overflow-auto px-2 py-3">
        <div className="grid gap-1.5">
          {threads.map((thread) => {
            const active = isChat && thread.id === activeChatId;
            return (
              <Link
                key={thread.id}
                href={`/dashboard/agent?chat=${encodeURIComponent(thread.id)}`}
                title={thread.title}
                className={`grid h-10 w-full place-items-center rounded-xl text-xs font-semibold uppercase transition ${
                  active ? "bg-[#eeeeec] text-neutral-950" : "text-gray-500 hover:bg-neutral-100 hover:text-black"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {threadInitial(thread.title)}
              </Link>
            );
          })}
        </div>
      </div>

      <nav className="shrink-0 border-t border-gray-200 p-2" aria-label="Compact dashboard navigation">
        <div className="grid gap-1.5">
          {navItems.map((item) => {
            const active = activeModal === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenModal(item.id)}
                className={`grid h-10 place-items-center rounded-xl text-xs font-semibold transition ${
                  active ? "bg-[#eeeeec] text-neutral-950" : "text-gray-500 hover:bg-neutral-100 hover:text-black"
                }`}
                aria-label={item.label}
                title={item.label}
                aria-pressed={active}
              >
                <Icon name={item.icon} />
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function ExpandedSidebar({
  workspace,
  threads,
  activeChatId,
  isChat,
  newChatActive,
  homeHref,
  activeModal,
  savingChatId,
  onRenameChat,
  onDeleteChat,
  onOpenModal,
  onNavigate
}: {
  workspace: Workspace;
  threads: ChatThread[];
  activeChatId: string;
  isChat: boolean;
  newChatActive: boolean;
  homeHref: string;
  activeModal: ShellModal;
  savingChatId: string | null;
  onRenameChat: (chatId: string, title: string) => Promise<void>;
  onDeleteChat: (chatId: string) => Promise<void>;
  onOpenModal: (modal: Exclude<ShellModal, null>) => void;
  onNavigate: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function beginEdit(thread: ChatThread) {
    setError(null);
    setDeleteConfirmId(null);
    setEditingId(thread.id);
    setDraftTitle(thread.title);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, thread: ChatThread) {
    event.preventDefault();
    const title = draftTitle.replace(/\s+/g, " ").trim();
    if (!title || title === thread.title) {
      setEditingId(null);
      return;
    }
    setError(null);
    try {
      await onRenameChat(thread.id, title);
      setEditingId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function confirmDelete(thread: ChatThread) {
    setError(null);
    try {
      await onDeleteChat(thread.id);
      setDeleteConfirmId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  return (
    <div className="flex h-full flex-col border-r border-gray-200 bg-[#f7f7f4] shadow-2xl shadow-black/15">
      <div className="border-b border-gray-200 px-3">
        <div className="flex h-[65px] items-center gap-3">
          <Link href={homeHref} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3" aria-label="A2W chat home">
            <AppLogo decorative className="h-10 w-10 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">A2W-Codex-Terraform-v0.0.1</span>
              <span className="block truncate text-xs text-gray-500">{workspace.companyName}</span>
            </span>
          </Link>
        </div>
      </div>

      <div className="border-b border-gray-200 p-3">
        <Link
          href="/dashboard/agent?chat=new"
          onClick={onNavigate}
          className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
            newChatActive ? "bg-[#eeeeec] text-neutral-950" : "text-gray-600 hover:bg-neutral-100 hover:text-black"
          }`}
          aria-current={newChatActive ? "page" : undefined}
        >
          <Icon name="fa-plus" />
          <span>New chat</span>
        </Link>
      </div>

      <div className="sidebar-scrollbar min-h-0 flex-1 overflow-auto p-3">
        <div className="grid gap-1.5">
          {threads.length ? (
            threads.map((thread) => {
              const active = isChat && thread.id === activeChatId;
              const saving = savingChatId === thread.id;
              if (editingId === thread.id) {
                return (
                  <form
                    key={thread.id}
                    onSubmit={(event) => submitEdit(event, thread)}
                    className={`grid gap-2 rounded-xl p-2 ${
                      active ? "bg-[#eeeeec] text-neutral-950" : "bg-neutral-100/70 text-gray-700"
                    }`}
                  >
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      disabled={saving}
                      autoFocus
                      maxLength={80}
                      className="h-9 min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm font-semibold outline-none transition focus:border-gray-400 disabled:text-gray-400"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                        className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 transition hover:bg-white hover:text-black disabled:opacity-50"
                        aria-label="Cancel rename"
                        title="Cancel"
                      >
                        <Icon name="fa-xmark" />
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-black text-white transition hover:bg-gray-800 disabled:bg-gray-300"
                        aria-label="Save chat title"
                        title="Save"
                      >
                        <Icon name={saving ? "fa-circle-notch fa-spin" : "fa-check"} />
                      </button>
                    </div>
                  </form>
                );
              }

              if (deleteConfirmId === thread.id) {
                return (
                  <div
                    key={thread.id}
                    className={`grid gap-2 rounded-xl p-2 ${
                      active ? "bg-[#eeeeec] text-neutral-950" : "bg-neutral-100/70 text-gray-700"
                    }`}
                  >
                    <p className="px-1 text-xs font-medium leading-5 text-gray-600">Delete this chat?</p>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        disabled={saving}
                        className="h-8 rounded-lg px-2 text-xs font-semibold text-gray-500 transition hover:bg-white hover:text-black disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDelete(thread)}
                        disabled={saving}
                        className="h-8 rounded-lg bg-red-600 px-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:bg-red-300"
                      >
                        {saving ? "Deleting" : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={thread.id}
                  className={`group/chat flex h-11 w-full min-w-0 items-center gap-1 overflow-hidden rounded-xl pl-3 pr-1 text-left transition ${
                    active ? "bg-[#eeeeec] text-neutral-950" : "text-gray-600 hover:bg-neutral-100 hover:text-black"
                  }`}
                >
                  <Link
                    href={`/dashboard/agent?chat=${encodeURIComponent(thread.id)}`}
                    onClick={onNavigate}
                    title={thread.title}
                    className="w-0 min-w-0 flex-1"
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="block truncate text-sm font-semibold">{thread.title}</span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => beginEdit(thread)}
                      disabled={saving}
                      className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-white hover:text-black disabled:opacity-50"
                      aria-label={`Rename ${thread.title}`}
                      title="Rename"
                    >
                      <Icon name="fa-pen" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEditingId(null);
                        setDeleteConfirmId(thread.id);
                      }}
                      disabled={saving}
                      className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label={`Delete ${thread.title}`}
                      title="Delete"
                    >
                      <Icon name="fa-trash" />
                    </button>
                  </span>
                </div>
              );
            })
          ) : (
            <p className="rounded-xl px-3 py-4 text-sm leading-6 text-gray-500">No chats yet.</p>
          )}
          {error ? <p className="px-3 py-2 text-xs leading-5 text-red-600">{error}</p> : null}
        </div>
      </div>

      <nav className="shrink-0 border-t border-gray-200 p-3" aria-label="Dashboard navigation">
        <div className="grid gap-1.5">
          {navItems.map((item) => {
            const active = activeModal === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenModal(item.id)}
                className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
                  active ? "bg-[#eeeeec] text-neutral-950" : "text-gray-600 hover:bg-neutral-100 hover:text-black"
                }`}
                aria-pressed={active}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function buildChatThreads(chats: Chat[]): ChatThread[] {
  return chats
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((chat) => {
      return {
        id: chat.id,
        title: chat.title
      };
    });
}

function threadInitial(title: string) {
  return title.trim().slice(0, 1) || "C";
}
