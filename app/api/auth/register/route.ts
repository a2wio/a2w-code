import { errorJson, json } from "@/src/lib/http";

export const runtime = "nodejs";

export async function POST() {
  return errorJson("Registration is disabled. Configure A2W_ADMIN_USERNAME and A2W_ADMIN_PASSWORD, then sign in.", 404);
}

export async function GET() {
  return json({ registration: "disabled", mode: "self-hosted" });
}
