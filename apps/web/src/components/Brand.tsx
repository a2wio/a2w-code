import Link from "next/link";
import { AppLogo } from "./AppLogo";

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3">
      <AppLogo decorative className="h-10 w-10" />
      <span>
        <span className={`block text-sm font-semibold ${dark ? "text-white" : "text-black"}`}>A2W-Codex-Terraform-v0.0.1</span>
        <span className="block text-xs text-gray-500">Prompt-operated cloud work</span>
      </span>
    </Link>
  );
}
