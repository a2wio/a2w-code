"use client";

import { ReactNode } from "react";
import { Icon } from "./Icon";

export function Modal({
  title,
  description,
  icon,
  iconClassName,
  iconFrameClassName,
  danger,
  size = "md",
  children,
  onClose
}: {
  title: string;
  description: string;
  icon: string;
  iconClassName?: string;
  iconFrameClassName?: string;
  danger?: boolean;
  size?: "md" | "xl";
  children: ReactNode;
  onClose: () => void;
}) {
  const frame = "h-[calc(100vh-48px)] w-[calc(100vw-48px)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/5 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className={`modal-enter ${frame} rounded-[2rem] border border-white/70 bg-white/90 p-2 shadow-2xl shadow-black/12`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`flex h-full flex-col overflow-hidden rounded-[1.5rem] border bg-white/90 ${danger ? "border-red-100" : "border-gray-200"}`}>
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 p-6">
            <div className="flex items-start gap-4">
              <span
                className={iconFrameClassName || `grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${
                  danger ? "bg-red-700" : "bg-black"
                }`}
              >
                <Icon name={icon} className={iconClassName} />
              </span>
              <div>
                <h2 className={`text-2xl font-semibold tracking-[-0.03em] ${danger ? "text-red-950" : "text-black"}`}>
                  {title}
                </h2>
                <p className={`mt-2 text-sm leading-6 ${danger ? "text-red-800" : "text-gray-600"}`}>{description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-gray-200 text-gray-500 transition hover:border-gray-300 hover:text-black"
            >
              <Icon name="fa-xmark" />
            </button>
          </div>
          <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-6 py-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
