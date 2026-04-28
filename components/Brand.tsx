import Link from "next/link";

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span
        className={`grid h-10 w-10 place-items-center rounded-2xl text-[11px] font-semibold shadow-sm ${
          dark ? "bg-white text-black" : "bg-black text-white"
        }`}
      >
        A2W
      </span>
      <span>
        <span className={`block text-sm font-semibold ${dark ? "text-white" : "text-black"}`}>Terraform Garden</span>
        <span className="block text-xs text-gray-500">Prompt-operated cloud work</span>
      </span>
    </Link>
  );
}
