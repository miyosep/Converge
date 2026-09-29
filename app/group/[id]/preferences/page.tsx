import { GroupWorkspace } from "../../../components/group-workspace";

export default async function PreferencesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GroupWorkspace key={id} initialGroupId={id} mode="preferences" />;
}
