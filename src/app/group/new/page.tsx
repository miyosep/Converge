import Link from "next/link";

export default function NewGroupPage() {
  return (
    <div className="container">
      <nav className="nav">
        <span className="nav-brand">Converge</span>
        <div className="nav-links">
          <Link href="/">Groups</Link>
          <Link href="/evidence">Evidence</Link>
        </div>
      </nav>

      <h1>Create a Group</h1>
      <p className="subtitle">
        Set up a group reservation. Each member submits private preferences.
      </p>

      <div className="card">
        <div className="form-group">
          <label htmlFor="name">Group name</label>
          <input id="name" type="text" placeholder="Seoul Saturday Dinner" />
        </div>
        <div className="form-group">
          <label htmlFor="slot">Reservation time</label>
          <input
            id="slot"
            type="datetime-local"
            defaultValue="2026-10-03T19:00"
          />
        </div>
        <div className="form-group">
          <label htmlFor="tz">Time zone</label>
          <select id="tz" defaultValue="Asia/Seoul">
            <option value="Asia/Seoul">Asia/Seoul</option>
            <option value="Asia/Shanghai">Asia/Shanghai</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
          </select>
        </div>
        <button className="btn btn-primary">Create group</button>
      </div>
    </div>
  );
}
