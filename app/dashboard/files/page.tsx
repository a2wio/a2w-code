import { FilesBrowser } from "@/components/FilesBrowser";
import { requireDashboardData } from "@/src/lib/dashboard";
import { listWorkspaceFiles } from "@/src/lib/materialize";

export default async function FilesPage() {
  const data = await requireDashboardData();
  const files = await listWorkspaceFiles(data.workspace.id);
  return <FilesBrowser initialFiles={files} />;
}
