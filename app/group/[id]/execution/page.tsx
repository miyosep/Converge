import { GroupScreen } from "../../../components/group-screen";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GroupScreen key={id} id={id} stage="execution" />;
}
