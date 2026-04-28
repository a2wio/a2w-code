"use client";

import { Icon } from "./Icon";

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white shadow-2xl shadow-black/20">
      <Icon name="fa-check" />
      <span className="ml-2">{message}</span>
    </div>
  );
}
