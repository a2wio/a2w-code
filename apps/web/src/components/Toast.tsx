"use client";

import { Icon } from "./Icon";

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed right-5 top-[81px] z-[60] max-w-[min(420px,calc(100vw-40px))] rounded-full bg-black px-5 py-3 text-sm font-semibold text-white shadow-2xl shadow-black/20">
      <Icon name="fa-check" />
      <span className="ml-2">{message}</span>
    </div>
  );
}
