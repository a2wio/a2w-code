import { logoutUser } from "@/lib/auth";
import { json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  await logoutUser();
  return json({ ok: true });
}
