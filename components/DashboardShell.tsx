"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ReactNode, useState } from "react";
import type { Chat, InfraPlan, Message, Workspace } from "@/src/lib/types";
import { Icon } from "./Icon";

const navItems = [
  ["agent", "Chat"],
  ["files", "Files"],
  ["settings", "Settings"]
] as const;

type ChatThread = {
  id: string;
  title: string;
};

export function DashboardShell({
  workspace,
  chats,
  messages,
  plans,
  children
}: {
  workspace: Workspace;
  chats: Chat[];
  messages: Message[];
  plans: InfraPlan[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const activeChatId = searchParams.get("chat") || "new";
  const threads = buildChatThreads(chats);
  const isChat = pathname === "/dashboard/agent";
  const isFiles = pathname === "/dashboard/files";
  const newChatActive = isChat && activeChatId === "new";
  const editorMode = isChat && activeChatId !== "new";

  return (
    <main className="h-full overflow-hidden border border-gray-200 bg-white text-black">
      <div className="flex h-full">
        <aside
          className={`${editorMode ? "hidden" : "flex"} h-full shrink-0 flex-col border-r border-gray-200 bg-[#f7f7f4] transition-[width] duration-300 ${
            sidebarOpen ? "w-72" : "w-[4.5rem]"
          }`}
        >
          <div className="border-b border-gray-200 px-3">
            {sidebarOpen ? (
              <div className="flex h-16 items-center justify-between gap-2">
                <Link href="/dashboard/agent" className="flex min-w-0 flex-1 items-center gap-3" aria-label="A2W chat home">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-black text-[11px] font-semibold text-white">
                    A2W
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">A2W-Codex-Terraform-v0.0.1</span>
                    <span className="block truncate text-xs text-gray-500">{workspace.companyName}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-gray-400 transition hover:text-gray-700"
                  aria-label="Collapse sidebar"
                >
                  <Icon name="fa-angles-left" />
                </button>
              </div>
            ) : (
              <div className="grid h-16 place-items-center">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="group relative grid h-10 w-10 place-items-center rounded-2xl bg-black text-white transition hover:bg-gray-900"
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                >
                  <span className="text-[11px] font-semibold transition duration-150 group-hover:scale-90 group-hover:opacity-0">
                    A2W
                  </span>
                  <span className="absolute inset-0 grid place-items-center opacity-0 transition duration-150 group-hover:opacity-100">
                    <Icon name="fa-angles-right" />
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="border-b border-gray-200 p-3">
            <Link
              href="/dashboard/agent"
              className={`flex h-11 w-full items-center rounded-xl text-sm font-semibold transition ${
                newChatActive ? "bg-[#eeeeec] text-neutral-950" : "text-gray-600 hover:bg-neutral-100 hover:text-black"
              } ${
                sidebarOpen ? "justify-start gap-3 px-3" : "justify-center"
              }`}
            >
              <Icon name="fa-plus" />
              {sidebarOpen ? <span>New chat</span> : null}
            </Link>
          </div>

          <div className="sidebar-scrollbar min-h-0 flex-1 overflow-auto p-3">
            <div className="grid gap-1.5">
              {threads.map((thread) => {
                const active = isChat && thread.id === activeChatId;
                return (
                  <Link
                    key={thread.id}
                    href={`/dashboard/agent?chat=${encodeURIComponent(thread.id)}`}
                    title={thread.title}
                    className={`flex h-11 w-full min-w-0 items-center overflow-hidden rounded-xl text-left transition ${
                      active ? "bg-[#eeeeec] text-neutral-950" : "text-gray-600 hover:bg-neutral-100 hover:text-black"
                    } ${sidebarOpen ? "px-3" : "justify-center px-0"}`}
                  >
                    {sidebarOpen ? (
                      <span className="w-0 min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{thread.title}</span>
                      </span>
                    ) : (
                      <span className="text-xs font-semibold uppercase">{thread.title.slice(0, 1)}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          <nav className="h-[156px] border-t border-gray-200 p-3">
            <div className="grid gap-1.5">
              {navItems.map(([slug, label]) => {
                const href = `/dashboard/${slug}`;
                const active = pathname === href;
                return (
                  <Link
                    key={slug}
                    href={href}
                    className={`flex h-11 items-center rounded-xl text-sm font-semibold transition ${
                      active ? "bg-[#eeeeec] text-neutral-950" : "text-gray-600 hover:bg-neutral-100 hover:text-black"
                    } ${sidebarOpen ? "gap-3 px-3" : "justify-center"}`}
                  >
                    <span>{sidebarOpen ? label : label.slice(0, 1)}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
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
    </main>
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
