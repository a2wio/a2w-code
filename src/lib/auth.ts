import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { updateData, readData, ensureWorkspaceFolders } from "./data";
import type { CloudProvider, SessionPayload, User, Workspace } from "./types";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "a2w_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SELF_HOST_USER_ID = "selfhost-admin";
const SELF_HOST_WORKSPACE_ID = "selfhost-workspace";

function authSecret() {
  return process.env.AUTH_SECRET || "dev-only-change-me";
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return { salt, hash: derived.toString("hex") };
}

export async function verifyPassword(password: string, salt: string, hash: string) {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

export function normalizeProvider(value: string | null | undefined): CloudProvider {
  const key = String(value || "").toLowerCase();
  if (key === "azure" || key === "aks") return "azure";
  if (key === "gcp" || key === "gke" || key === "google") return "gcp";
  return "aws";
}

export async function registerUser() {
  throw new Error("Registration is disabled. This self-hosted console uses A2W_ADMIN_USERNAME and A2W_ADMIN_PASSWORD.");
}

export async function loginUser(input: { username?: string; email?: string; password: string }) {
  const admin = configuredAdmin();
  const username = String(input.username || input.email || "").trim();
  if (!safeEqual(username, admin.username) || !safeEqual(input.password, admin.password)) {
    throw new Error("Invalid username or password.");
  }

  const { user, workspace } = await ensureSelfHostedAccount(admin);
  await ensureWorkspaceFolders(workspace);
  await setSession({ userId: user.id, workspaceId: workspace.id, exp: sessionExpiry() });
  return { user: publicUser(user), workspace };
}

function configuredAdmin() {
  const password = process.env.A2W_ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "password123");
  if (!password) {
    throw new Error("Set A2W_ADMIN_PASSWORD before signing in.");
  }

  return {
    username: process.env.A2W_ADMIN_USERNAME || "admin",
    password,
    operatorName: process.env.A2W_OPERATOR_NAME || "Platform Operator",
    workspaceName: process.env.A2W_WORKSPACE_NAME || "Local Platform",
    defaultCloud: normalizeProvider(process.env.A2W_DEFAULT_CLOUD || "azure")
  };
}

async function ensureSelfHostedAccount(admin: ReturnType<typeof configuredAdmin>) {
  return updateData((data) => {
    const createdAt = new Date().toISOString();
    let user = data.users.find((item) => item.id === SELF_HOST_USER_ID);
    if (!user) {
      user = {
        id: SELF_HOST_USER_ID,
        name: admin.operatorName,
        email: admin.username,
        passwordHash: "self-hosted-env",
        passwordSalt: "self-hosted-env",
        createdAt
      };
      data.users.push(user);
    } else {
      user.name = admin.operatorName;
      user.email = admin.username;
    }

    let workspace = data.workspaces.find((item) => item.id === SELF_HOST_WORKSPACE_ID);
    if (!workspace) {
      workspace = {
        id: SELF_HOST_WORKSPACE_ID,
        userId: user.id,
        companyName: admin.workspaceName,
        cloudPreference: admin.defaultCloud,
        createdAt
      };
      data.workspaces.push(workspace);
      data.events.push({
        id: randomBytes(16).toString("hex"),
        workspaceId: workspace.id,
        type: "workspace.registered",
        label: `${workspace.companyName} self-hosted console initialized`,
        createdAt
      });
    } else {
      workspace.userId = user.id;
      workspace.companyName = admin.workspaceName;
      if (!workspace.onboardingCompletedAt) workspace.cloudPreference = admin.defaultCloud;
    }

    return { user, workspace };
  });
}

export async function logoutUser() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  if (sign(payload) !== signature) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export async function getCurrentContext() {
  const session = await getSession();
  if (!session) return null;
  if (session.userId !== SELF_HOST_USER_ID || session.workspaceId !== SELF_HOST_WORKSPACE_ID) return null;
  const data = await readData();
  const user = data.users.find((item) => item.id === session.userId);
  const workspace = data.workspaces.find((item) => item.id === session.workspaceId && item.userId === session.userId);
  if (!user || !workspace) return null;
  return { user: publicUser(user), workspace, data };
}

async function setSession(session: SessionPayload) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

function sign(payload: string) {
  return createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sessionExpiry() {
  return Date.now() + SESSION_TTL_SECONDS * 1000;
}

function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}
