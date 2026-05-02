import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PROJECT_ROOT } from "./data";
import type { WorkspaceMode } from "./types";

type KubernetesConfig = {
  host: string;
  port: string;
  namespace: string;
  token: string;
  ca?: Buffer;
};

type KubernetesApiError = Error & {
  statusCode?: number;
  responseBody?: string;
};

type KubernetesJob = {
  status?: {
    succeeded?: number;
    failed?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
};

type KubernetesPodList = {
  items?: Array<{
    metadata?: { name?: string };
    status?: {
      phase?: string;
      containerStatuses?: Array<{
        name?: string;
        state?: {
          terminated?: {
            exitCode?: number;
            reason?: string;
            message?: string;
          };
        };
      }>;
    };
  }>;
};
type KubernetesPod = NonNullable<KubernetesPodList["items"]>[number];

export type KubernetesSandboxResult = {
  output: string;
  exitCode: number | null;
};

export type KubernetesSandboxInput = {
  runId: string;
  workspaceId: string;
  workspaceMode?: WorkspaceMode;
  mode: string;
  image: string;
  script: string;
  env: Record<string, string>;
  allowNetwork?: boolean;
  timeoutMs: number;
};

const SCRIPT_FILES = [
  "terraform-fmt.sh",
  "terraform-plan.sh",
  "terraform-apply.sh",
  "terraform-destroy.sh",
  "npm-install.sh",
  "npm-audit.sh",
  "npm-lint.sh",
  "npm-test.sh",
  "npm-build.sh",
  "validate.sh"
];

export function kubernetesSandboxJobName(runId: string) {
  return `a2w-sandbox-${runId.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 12)}`;
}

export async function runKubernetesSandbox(input: KubernetesSandboxInput): Promise<KubernetesSandboxResult> {
  const config = await kubernetesConfig();
  const jobName = kubernetesSandboxJobName(input.runId);
  const scriptConfigMapName = `${jobName}-scripts`;
  const envSecretName = `${jobName}-env`;
  const networkPolicyName = `${jobName}-deny-egress`;
  const labels = {
    app: "a2w-codex-terraform",
    "a2w.dev/component": "sandbox",
    "a2w.dev/sandbox-run": input.runId
  };

  let createdJob = false;

  try {
    await k8sJson(config, "POST", `/api/v1/namespaces/${config.namespace}/configmaps`, {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: scriptConfigMapName, namespace: config.namespace, labels },
      data: await sandboxScriptData()
    });

    await k8sJson(config, "POST", `/api/v1/namespaces/${config.namespace}/secrets`, {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: envSecretName, namespace: config.namespace, labels },
      type: "Opaque",
      stringData: input.env
    });

    if (!input.allowNetwork && process.env.A2W_K8S_DISABLE_NETWORK_POLICY !== "true") {
      await k8sJson(config, "POST", `/apis/networking.k8s.io/v1/namespaces/${config.namespace}/networkpolicies`, {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: networkPolicyName, namespace: config.namespace, labels },
        spec: {
          podSelector: {
            matchLabels: {
              "a2w.dev/sandbox-run": input.runId
            }
          },
          policyTypes: ["Egress"],
          egress: []
        }
      });
    }

    await k8sJson(config, "POST", `/apis/batch/v1/namespaces/${config.namespace}/jobs`, sandboxJob({
      ...input,
      namespace: config.namespace,
      jobName,
      scriptConfigMapName,
      envSecretName,
      labels
    }));
    createdJob = true;

    const finished = await waitForJob(config, jobName, input.timeoutMs);
    const pod = await findJobPod(config, jobName);
    const logs = pod?.metadata?.name ? await podLogs(config, pod.metadata.name) : "";
    const exitCode = containerExitCode(pod) ?? (finished.succeeded ? 0 : 1);
    const statusDetail = finished.message ? `\n\nKubernetes job status: ${finished.message}` : "";

    return {
      output: `${logs.trim()}${statusDetail}`.trim(),
      exitCode
    };
  } finally {
    if (process.env.A2W_K8S_KEEP_SANDBOX_JOBS !== "true" && createdJob) {
      await cleanup(config, "DELETE", `/apis/batch/v1/namespaces/${config.namespace}/jobs/${jobName}`, { propagationPolicy: "Background" });
    }
    await cleanup(config, "DELETE", `/api/v1/namespaces/${config.namespace}/secrets/${envSecretName}`);
    await cleanup(config, "DELETE", `/api/v1/namespaces/${config.namespace}/configmaps/${scriptConfigMapName}`);
    if (!input.allowNetwork && process.env.A2W_K8S_DISABLE_NETWORK_POLICY !== "true") {
      await cleanup(config, "DELETE", `/apis/networking.k8s.io/v1/namespaces/${config.namespace}/networkpolicies/${networkPolicyName}`);
    }
  }
}

export function formatKubernetesSandboxFailure(error: unknown) {
  const err = error as KubernetesApiError;
  const raw = [err.message, err.responseBody].filter(Boolean).join("\n\n").trim();

  if (raw.toLowerCase().includes("serviceaccount") || raw.toLowerCase().includes("kubernetes_service_host")) {
    return [
      "The Kubernetes sandbox backend is enabled, but the app is not running with in-cluster Kubernetes service-account credentials.",
      "",
      "Set A2W_SANDBOX_BACKEND=podman for local development, or deploy the app inside Kubernetes with the a2w-codex-terraform service account.",
      "",
      "Original output:",
      raw || "No output."
    ].join("\n");
  }

  if (err.statusCode === 403) {
    return [
      "Kubernetes rejected the sandbox Job request.",
      "",
      "The app service account needs permission to create/delete Jobs, ConfigMaps, Secrets, and NetworkPolicies in its namespace, plus read Pods and Pod logs.",
      "",
      "Original Kubernetes response:",
      raw || "No output."
    ].join("\n");
  }

  return raw || "Kubernetes sandbox failed without output.";
}

async function kubernetesConfig(): Promise<KubernetesConfig> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || "443";
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is not set.");

  const namespace = process.env.A2W_K8S_NAMESPACE || await readServiceAccountFile("namespace");
  const token = await readServiceAccountFile("token");
  const ca = await readOptionalServiceAccountFile("ca.crt");
  return { host, port, namespace: namespace.trim() || "default", token: token.trim(), ca };
}

async function readServiceAccountFile(name: string) {
  return readFile(`/var/run/secrets/kubernetes.io/serviceaccount/${name}`, "utf8");
}

async function readOptionalServiceAccountFile(name: string) {
  try {
    return await readFile(`/var/run/secrets/kubernetes.io/serviceaccount/${name}`);
  } catch {
    return undefined;
  }
}

async function sandboxScriptData() {
  const data: Record<string, string> = {};
  for (const file of SCRIPT_FILES) {
    data[file] = await readFile(join(PROJECT_ROOT, "sandbox", "scripts", file), "utf8");
  }
  return data;
}

function sandboxJob(input: KubernetesSandboxInput & {
  namespace: string;
  jobName: string;
  scriptConfigMapName: string;
  envSecretName: string;
  labels: Record<string, string>;
}) {
  const dataPvc = process.env.A2W_K8S_DATA_PVC || "a2w-codex-terraform-data";
  const sandboxServiceAccount = process.env.A2W_K8S_SANDBOX_SERVICE_ACCOUNT || "default";
  const workspaceSubPath = input.workspaceMode === "web"
    ? `workspaces/${input.workspaceId}/repositories/web`
    : `workspaces/${input.workspaceId}/repository`;

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: input.jobName,
      namespace: input.namespace,
      labels: input.labels
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 300,
      activeDeadlineSeconds: Math.ceil(input.timeoutMs / 1000),
      template: {
        metadata: {
          labels: input.labels
        },
        spec: {
          restartPolicy: "Never",
          serviceAccountName: sandboxServiceAccount,
          automountServiceAccountToken: false,
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            fsGroupChangePolicy: "OnRootMismatch"
          },
          containers: [
            {
              name: "sandbox",
              image: input.image,
              imagePullPolicy: process.env.A2W_K8S_SANDBOX_IMAGE_PULL_POLICY || "IfNotPresent",
              command: ["/bin/sh", input.script],
              workingDir: "/workspace",
              env: [{ name: "HOME", value: "/tmp" }],
              envFrom: [{ secretRef: { name: input.envSecretName } }],
              volumeMounts: [
                {
                  name: "workspace",
                  mountPath: "/workspace",
                  subPath: workspaceSubPath
                },
                {
                  name: "scripts",
                  mountPath: "/sandbox",
                  readOnly: true
                }
              ],
              resources: {
                requests: {
                  cpu: process.env.A2W_K8S_SANDBOX_CPU_REQUEST || "100m",
                  memory: process.env.A2W_K8S_SANDBOX_MEMORY_REQUEST || "256Mi"
                },
                limits: {
                  cpu: process.env.A2W_K8S_SANDBOX_CPU_LIMIT || "2",
                  memory: process.env.A2W_K8S_SANDBOX_MEMORY_LIMIT || "2Gi"
                }
              }
            }
          ],
          volumes: [
            {
              name: "workspace",
              persistentVolumeClaim: { claimName: dataPvc }
            },
            {
              name: "scripts",
              configMap: {
                name: input.scriptConfigMapName,
                defaultMode: 365
              }
            }
          ]
        }
      }
    }
  };
}

async function waitForJob(config: KubernetesConfig, jobName: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await k8sJson<KubernetesJob>(config, "GET", `/apis/batch/v1/namespaces/${config.namespace}/jobs/${jobName}`);
    const condition = job.status?.conditions?.find((item) => item.status === "True" && (item.type === "Complete" || item.type === "Failed"));
    if (job.status?.succeeded && job.status.succeeded > 0) return { succeeded: true, message: condition?.message || condition?.reason || "" };
    if (job.status?.failed && job.status.failed > 0) return { succeeded: false, message: condition?.message || condition?.reason || "Job failed." };
    await delay(1500);
  }
  throw new Error(`Timed out waiting for Kubernetes sandbox job ${jobName}.`);
}

async function findJobPod(config: KubernetesConfig, jobName: string) {
  const list = await k8sJson<KubernetesPodList>(
    config,
    "GET",
    `/api/v1/namespaces/${config.namespace}/pods?labelSelector=${encodeURIComponent(`job-name=${jobName}`)}`
  );
  return (list.items || [])[0];
}

function containerExitCode(pod?: KubernetesPod) {
  return pod?.status?.containerStatuses?.find((item) => item.name === "sandbox")?.state?.terminated?.exitCode ?? null;
}

async function podLogs(config: KubernetesConfig, podName: string) {
  return k8sText(config, "GET", `/api/v1/namespaces/${config.namespace}/pods/${podName}/log?container=sandbox&timestamps=false`);
}

async function cleanup(config: KubernetesConfig, method: string, path: string, body?: unknown) {
  try {
    await k8sJson(config, method, path, body, [200, 202, 404]);
  } catch {
    // Cleanup is best-effort; the sandbox run output is already captured.
  }
}

async function k8sJson<T = unknown>(config: KubernetesConfig, method: string, path: string, body?: unknown, okStatuses = [200, 201, 202]) {
  const text = await k8sText(config, method, path, body, okStatuses);
  return text ? JSON.parse(text) as T : {} as T;
}

async function k8sText(config: KubernetesConfig, method: string, path: string, body?: unknown, okStatuses = [200, 201, 202]) {
  const payload = body ? JSON.stringify(body) : undefined;
  const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = httpsRequest({
      method,
      hostname: config.host,
      port: config.port,
      path,
      ca: config.ca,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

  if (!okStatuses.includes(response.statusCode)) {
    const error = new Error(`Kubernetes API ${method} ${path} failed with HTTP ${response.statusCode}.`) as KubernetesApiError;
    error.statusCode = response.statusCode;
    error.responseBody = response.body;
    throw error;
  }

  return response.body;
}
