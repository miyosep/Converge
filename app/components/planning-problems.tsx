import { ArrowDown, LockKeyhole, MessageCircle, Wallet } from "lucide-react";

export function PlanningProblems() {
  return (
    <section
      className="planning-problems"
      id="why-converge"
      aria-labelledby="problems-title"
    >
      <div className="problems-heading">
        <p className="eyebrow">SOUND FAMILIAR?</p>
        <h2 id="problems-title">
          Getting together
          <br />
          shouldn't take this much work.
        </h2>
      </div>
      <div className="problems-grid">
        <article className="problem-card">
          <div
            className="problem-scene problem-chat"
            aria-label="An example group conversation going in circles"
          >
            <span className="problem-scene-label">
              <MessageCircle size={15} aria-hidden="true" /> The group chat
            </span>
            <span className="problem-bubble">Where should we go?</span>
            <span className="problem-bubble problem-bubble-right">
              I'm fine with anything!
            </span>
            <span className="problem-bubble">How about this place?</span>
            <span className="problem-bubble problem-bubble-right">
              Maybe somewhere else?
            </span>
            <span className="problem-loop">Still no plan…</span>
          </div>
          <h3>More messages. Still no plan.</h3>
          <p>Suggestions keep coming. A decision doesn't.</p>
        </article>
        <article className="problem-card">
          <div className="problem-scene problem-privacy">
            <span className="problem-scene-label">
              <LockKeyhole size={15} aria-hidden="true" /> What stays unsaid
            </span>
            <div className="problem-thought">
              “I'd rather spend less.
              <br />
              Do I have to tell everyone why?”
            </div>
            <div className="problem-unsent">
              <span>Budget. Food needs. Personal reasons.</span>
              <span>Not always easy to share.</span>
            </div>
          </div>
          <h3>Some things are personal.</h3>
          <p>You shouldn't have to explain every preference to the group.</p>
        </article>
        <article className="problem-card">
          <div className="problem-scene problem-organiser">
            <span className="problem-scene-label">
              <Wallet size={15} aria-hidden="true" /> The unofficial organiser
            </span>
            <div className="problem-tasks">
              {[
                "Find a place",
                "Check with everyone",
                "Pay the deposit",
                "Chase everyone's share",
              ].map((task) => (
                <div key={task}>
                  <span className="problem-checkbox" aria-hidden="true" />
                  {task}
                </div>
              ))}
            </div>
            <span className="problem-loop">Somehow, it's all on you.</span>
          </div>
          <h3>One person does the chasing.</h3>
          <p>Coordinating the plan and collecting money becomes another job.</p>
        </article>
      </div>
      <a className="problems-bridge" href="#how-it-works">
        <span>
          A little less back-and-forth.
          <br />
          <strong>A plan you can all agree on.</strong>
        </span>
        <ArrowDown size={22} aria-hidden="true" />
      </a>
    </section>
  );
}
