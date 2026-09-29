import Link from "next/link";
import { GroupWorkspace } from "../../components/group-workspace";

export default function CatalogDemoPage() {
  return (
    <>
      <aside className="flow-note" aria-label="Archived catalog demo">
        <strong>Archived example planning</strong>
        <p>
          This demo uses 200 fictional places across five categories. These are
          sample venues for the group and payment demonstration.
        </p>
        <Link href="/discover">Search real places instead</Link>
      </aside>
      <GroupWorkspace mode="create" />
    </>
  );
}
