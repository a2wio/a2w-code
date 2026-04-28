import { logoutUser } from "@/src/lib/auth";
import { json } from "@/src/lib/http";

export const runtime = "nodejs";

export async function POST() {
  await logoutUser();
  return json({ ok: true });
}
