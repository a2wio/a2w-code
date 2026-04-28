import { NextRequest } from "next/server";
import { loginUser } from "@/src/lib/auth";
import { errorJson, json } from "@/src/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await loginUser({
      username: String(body.username || body.email || ""),
      password: String(body.password || "")
    });
    return json(result);
  } catch (error) {
    return errorJson(error, 401);
  }
}
