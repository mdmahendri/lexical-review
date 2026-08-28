// Three capability-demo structures, switchable via ?variant=, on the existing demo route.
import { useEffect, useMemo, useState } from "react";
import "./capability-demo.prototype.css";

type VariantKey = "A" | "B" | "C";
type Route = "Keyboard" | "Toolbar" | "Programmatic";
type Projection = "Review" | "All accepted" | "Accepted state";
type Artifact = "Native" | "WER v1" | "Mapping report";

type Fixture = {
  id: string;
  title: string;
  group: string;
  summary: string;
  accepted: string;
  reviewBefore: string;
  reviewAfter: string;
  allAccepted: string;
  proposal: string;
  outcome: "changed" | "refused";
  outcomeReason: string;
  portable: boolean;
  semanticTarget: string;
  semanticPayload: string;
  acceptMeaning: string;
  rejectMeaning: string;
};

const fixtures: Fixture[] = [
  {
    id: "adjacent-insertion",
    title: "Adjacent insertion draft",
    group: "Authoring",
    summary:
      "Type beside finalized work from the accepted side, then explicitly finalize the draft.",
    accepted: "The revised launch note ships Friday.",
    reviewBefore: "The revised launch note ships Friday.",
    reviewAfter: "The revised launch note ships next Friday.",
    allAccepted: "The revised launch note ships next Friday.",
    proposal: "p-104 · insertion · pending",
    outcome: "changed",
    outcomeReason: "draft-finalized",
    portable: true,
    semanticTarget: "Paragraph 1 · accepted point after “ships ”",
    semanticPayload: "Insert “next ”",
    acceptMeaning: "Keep “next ” in accepted content",
    rejectMeaning: "Return to “ships Friday”",
  },
  {
    id: "atomic-replacement",
    title: "Atomic replacement",
    group: "Authoring",
    summary:
      "Replace one same-paragraph accepted range as one independently resolvable intention.",
    accepted: "The review window closes Thursday.",
    reviewBefore: "The review window closes Thursday.",
    reviewAfter: "The review window closes Friday.",
    allAccepted: "The review window closes Friday.",
    proposal: "p-105 · atomic replacement · pending",
    outcome: "changed",
    outcomeReason: "proposal-created",
    portable: true,
    semanticTarget: "Paragraph 1 · accepted text “Thursday”",
    semanticPayload: "Replace with “Friday”",
    acceptMeaning: "Accepted content becomes “Friday”",
    rejectMeaning: "Accepted content remains “Thursday”",
  },
  {
    id: "paragraph-split",
    title: "Paragraph split",
    group: "Structure",
    summary:
      "Split one accepted paragraph at a collapsed accepted-state point.",
    accepted: "Context first. Decision second.",
    reviewBefore: "Context first. Decision second.",
    reviewAfter: "Context first.\nDecision second.",
    allAccepted: "Context first.\nDecision second.",
    proposal: "p-106 · paragraph split · pending",
    outcome: "changed",
    outcomeReason: "proposal-created",
    portable: true,
    semanticTarget: "Paragraph 1 · boundary before “Decision”",
    semanticPayload: "Create one paragraph boundary",
    acceptMeaning: "Keep the two resulting paragraphs",
    rejectMeaning: "Restore one continuous paragraph",
  },
  {
    id: "fragment-paste",
    title: "Multiline fragment paste",
    group: "Interchange edge",
    summary:
      "Author one native atomic document-fragment insertion, then attempt WER v1 output.",
    accepted: "Migration notes follow.",
    reviewBefore: "Migration notes follow.",
    reviewAfter: "Migration notes follow.\nStep one\nStep two",
    allAccepted: "Migration notes follow.\nStep one\nStep two",
    proposal: "p-107 · document fragment · pending",
    outcome: "refused",
    outcomeReason: "unsupported-proposal-kind",
    portable: false,
    semanticTarget: "Paragraph 1 · collapsed point after the period",
    semanticPayload: "Insert two paragraphs: “Step one”, “Step two”",
    acceptMeaning: "Keep the inserted document fragment",
    rejectMeaning: "Remove the whole fragment atomically",
  },
  {
    id: "proposal-boundary",
    title: "Finalized proposal boundary",
    group: "Refusal",
    summary:
      "Attempt direct editing on the proposal side of an immutable finalized proposal.",
    accepted: "Budget approval is pending.",
    reviewBefore: "Budget approval is still pending.",
    reviewAfter: "Budget approval is still pending.",
    allAccepted: "Budget approval is still pending.",
    proposal: "p-108 · insertion · pending",
    outcome: "refused",
    outcomeReason: "proposal-side-target",
    portable: true,
    semanticTarget: "Accepted point before “pending”",
    semanticPayload: "Insert “still ”",
    acceptMeaning: "Keep “still ” in accepted content",
    rejectMeaning: "Return to “approval is pending”",
  },
  {
    id: "composition",
    title: "Completed composition",
    group: "Input route",
    summary:
      "Normalize a completed IME session into one insertion intention without finalizing it.",
    accepted: "Status: ",
    reviewBefore: "Status: ",
    reviewAfter: "Status: 準備完了",
    allAccepted: "Status: 準備完了",
    proposal: "active draft · insertion · no identity",
    outcome: "changed",
    outcomeReason: "draft-evolved",
    portable: false,
    semanticTarget: "Paragraph 1 · accepted point after “Status: ”",
    semanticPayload: "Draft insertion “準備完了”",
    acceptMeaning: "Finalize before it can be accepted",
    rejectMeaning: "Discard the draft without proposal identity",
  },
];

const variantNames: Record<VariantKey, string> = {
  A: "Operator workbench",
  B: "Guided scenario lab",
  C: "Document + instruments",
};

type PrototypeState = {
  fixture: Fixture;
  route: Route;
  projection: Projection;
  artifact: Artifact;
  lastAction: string;
  setFixtureId: (id: string) => void;
  setRoute: (route: Route) => void;
  setProjection: (projection: Projection) => void;
  setArtifact: (artifact: Artifact) => void;
  act: (action: string) => void;
};

function readVariant(): VariantKey {
  const candidate = new URLSearchParams(window.location.search).get("variant");
  return candidate === "B" || candidate === "C" ? candidate : "A";
}

function usePrototypeState(): PrototypeState {
  const [fixtureId, setFixtureId] = useState(fixtures[0]!.id);
  const [route, setRoute] = useState<Route>("Keyboard");
  const [projection, setProjection] = useState<Projection>("Review");
  const [artifact, setArtifact] = useState<Artifact>("Mapping report");
  const [lastAction, setLastAction] = useState("Loaded fixture");
  const fixture =
    fixtures.find((candidate) => candidate.id === fixtureId) ?? fixtures[0]!;

  return {
    fixture,
    route,
    projection,
    artifact,
    lastAction,
    setFixtureId(id) {
      setFixtureId(id);
      setLastAction("Loaded fixture");
    },
    setRoute,
    setProjection,
    setArtifact,
    act(action) {
      setLastAction(action);
    },
  };
}

function documentText(state: PrototypeState) {
  if (state.projection === "Accepted state") return state.fixture.accepted;
  if (state.projection === "All accepted") return state.fixture.allAccepted;
  return state.fixture.reviewAfter;
}

function DocumentProjection({ state }: { state: PrototypeState }) {
  if (state.projection !== "Review") {
    return documentText(state)
      .split("\n")
      .map((line, index) => <p key={`${index}-${line}`}>{line || "\u00a0"}</p>);
  }

  switch (state.fixture.id) {
    case "adjacent-insertion":
      return (
        <p>
          The revised launch note ships <ins>next </ins>Friday.
        </p>
      );
    case "atomic-replacement":
      return (
        <p>
          The review window closes <del>Thursday</del>
          <ins>Friday</ins>.
        </p>
      );
    case "paragraph-split":
      return (
        <>
          <p>
            Context first.
            <span className="prototype-structural-marker">paragraph split</span>
          </p>
          <p className="prototype-inserted-paragraph">Decision second.</p>
        </>
      );
    case "fragment-paste":
      return (
        <>
          <p>Migration notes follow.</p>
          <p className="prototype-inserted-paragraph">
            <ins>Step one</ins>
          </p>
          <p className="prototype-inserted-paragraph">
            <ins>Step two</ins>
          </p>
        </>
      );
    case "proposal-boundary":
      return (
        <p>
          Budget approval is <ins>still </ins>pending.
        </p>
      );
    case "composition":
      return (
        <p>
          Status: <span className="prototype-draft">準備完了</span>
        </p>
      );
    default:
      return <p>{state.fixture.reviewAfter}</p>;
  }
}

function OutcomeBadge({ fixture }: { fixture: Fixture }) {
  return (
    <span className={`prototype-outcome is-${fixture.outcome}`}>
      {fixture.outcome}
    </span>
  );
}

function RouteButtons({ state }: { state: PrototypeState }) {
  return (
    <div className="prototype-segmented" aria-label="Input route">
      {(["Keyboard", "Toolbar", "Programmatic"] as const).map((route) => (
        <button
          className={state.route === route ? "is-active" : ""}
          key={route}
          onClick={() => {
            state.setRoute(route);
            state.act(`Selected ${route.toLowerCase()} route`);
          }}
          type="button"
        >
          {route}
        </button>
      ))}
    </div>
  );
}

function ProjectionButtons({ state }: { state: PrototypeState }) {
  return (
    <div className="prototype-segmented" aria-label="Projection">
      {(["Review", "All accepted", "Accepted state"] as const).map(
        (projection) => (
          <button
            className={state.projection === projection ? "is-active" : ""}
            key={projection}
            onClick={() => {
              state.setProjection(projection);
              state.act(`Switched to ${projection.toLowerCase()} projection`);
            }}
            type="button"
          >
            {projection}
          </button>
        ),
      )}
    </div>
  );
}

function ArtifactPanel({ state }: { state: PrototypeState }) {
  const nativeDocument = `ReviewDocumentV3\nproposal: ${state.fixture.proposal}\nselection: excluded\nuiState: excluded`;
  const werDocument = state.fixture.portable
    ? `WER v1 · json-jcs-1\nmodelVersion: 1\nproposal kind: portable\nfingerprint: 90d4…c2a1`
    : `WER v1 output unavailable\nnative state preserved\nproposal: ${state.fixture.proposal}`;
  const mapping = state.fixture.portable
    ? `direction: native → WER v1\nstatus: mapped\nnormalizations: 0\nlosses: 0`
    : `direction: native → WER v1\nstatus: unsupported\nreason: ${state.fixture.outcomeReason}\nmutated: false`;
  const value =
    state.artifact === "Native"
      ? nativeDocument
      : state.artifact === "WER v1"
        ? werDocument
        : mapping;

  return (
    <div className="prototype-artifact">
      <div className="prototype-tabs" role="tablist">
        {(["Native", "WER v1", "Mapping report"] as const).map((artifact) => (
          <button
            aria-selected={state.artifact === artifact}
            className={state.artifact === artifact ? "is-active" : ""}
            key={artifact}
            onClick={() => {
              state.setArtifact(artifact);
              state.act(`Inspected ${artifact.toLowerCase()}`);
            }}
            role="tab"
            type="button"
          >
            {artifact}
          </button>
        ))}
      </div>
      <pre>{value}</pre>
    </div>
  );
}

function PrototypeStateStrip({ state }: { state: PrototypeState }) {
  return (
    <div className="prototype-state-strip">
      <span>PROTOTYPE STATE</span>
      <code>fixture={state.fixture.id}</code>
      <code>route={state.route}</code>
      <code>projection={state.projection}</code>
      <code>last={state.lastAction}</code>
    </div>
  );
}

function VariantA({ state }: { state: PrototypeState }) {
  return (
    <main className="variant-a">
      <header className="a-header">
        <div>
          <p className="prototype-eyebrow">
            LEXICAL REVIEW · V3 CAPABILITY DEMO
          </p>
          <h1>Review operation workbench</h1>
        </div>
        <div className="prototype-nonnormative">
          Capability surface · not a host UI
        </div>
      </header>

      <section className="a-grid">
        <aside className="a-fixtures">
          <p className="prototype-kicker">Fixture library</p>
          <h2>Choose an edge</h2>
          <div className="a-fixture-list">
            {fixtures.map((fixture, index) => (
              <button
                className={state.fixture.id === fixture.id ? "is-active" : ""}
                key={fixture.id}
                onClick={() => state.setFixtureId(fixture.id)}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{fixture.title}</strong>
                  <small>{fixture.group}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="a-canvas">
          <div className="a-canvas-toolbar">
            <RouteButtons state={state} />
            <button
              className="prototype-primary"
              onClick={() => state.act("Executed semantic intention")}
              type="button"
            >
              Replay intention
            </button>
          </div>
          <div className="a-context">
            <span>{state.fixture.group}</span>
            <h2>{state.fixture.title}</h2>
            <p>{state.fixture.summary}</p>
          </div>
          <div className="prototype-editor" data-projection={state.projection}>
            <div className="prototype-editor-meta">
              <span>Review document</span>
              <ProjectionButtons state={state} />
            </div>
            <div className="prototype-paper">
              <DocumentProjection state={state} />
            </div>
          </div>
          <div className="a-console">
            <div>
              <span>Normalized route</span>
              <strong>{state.route} → semantic intention</strong>
            </div>
            <div>
              <span>Operation result</span>
              <strong>
                <OutcomeBadge fixture={state.fixture} />{" "}
                {state.fixture.outcomeReason}
              </strong>
            </div>
            <div>
              <span>Mutation guarantee</span>
              <strong>
                {state.fixture.outcome === "refused"
                  ? "State and selection preserved"
                  : "Successor EditorState"}
              </strong>
            </div>
          </div>
        </section>

        <aside className="a-inspector">
          <p className="prototype-kicker">Proposal inspector</p>
          <h2>{state.fixture.proposal}</h2>
          <dl>
            <div>
              <dt>Semantic target</dt>
              <dd>accepted paragraph · offsets 30–36</dd>
            </div>
            <div>
              <dt>Identity</dt>
              <dd>immutable after finalization</dd>
            </div>
            <div>
              <dt>WER v1</dt>
              <dd>{state.fixture.portable ? "portable" : "unsupported"}</dd>
            </div>
          </dl>
          <div className="a-resolve-actions">
            <button
              onClick={() => state.act("Accepted selected proposal")}
              type="button"
            >
              Accept
            </button>
            <button
              onClick={() => state.act("Rejected selected proposal")}
              type="button"
            >
              Reject
            </button>
            <button
              onClick={() => state.act("Began proposal reauthoring")}
              type="button"
            >
              Reauthor
            </button>
          </div>
          <ArtifactPanel state={state} />
        </aside>
      </section>
      <PrototypeStateStrip state={state} />
    </main>
  );
}

function VariantB({ state }: { state: PrototypeState }) {
  const fixtureIndex = fixtures.findIndex(
    (fixture) => fixture.id === state.fixture.id,
  );
  const routeExample: Record<Route, string> = {
    Keyboard: `// Illustrative host shortcut\nonShortcut("Mod+Enter", () => {\n  session.finalizeDraft()\n})`,
    Toolbar: `<button onClick={() => session.finalizeDraft()}>\n  Finalize proposal\n</button>`,
    Programmatic: `const result = session.finalizeDraft()\n\nif (result.status === "refused") {\n  showReason(result.reason)\n}`,
  };
  const isDraft = state.fixture.proposal.startsWith("active draft");

  return (
    <main className="variant-b">
      <aside className="b-rail">
        <div className="b-brand">
          <span>LR</span>
          <div>
            <strong>Capability lab</strong>
            <small>Guided evidence</small>
          </div>
        </div>
        <p className="b-rail-boundary">
          Capability demo · not a required host interface
        </p>
        <nav>
          {fixtures.map((fixture, index) => (
            <button
              className={state.fixture.id === fixture.id ? "is-active" : ""}
              key={fixture.id}
              onClick={() => state.setFixtureId(fixture.id)}
              type="button"
            >
              <span>{index + 1}</span>
              <span>{fixture.title}</span>
              <small>{fixture.outcome}</small>
            </button>
          ))}
        </nav>
        <div className="b-rail-actions">
          <button
            onClick={() => state.act("Opened free-play editor placeholder")}
            type="button"
          >
            <span>Try it live</span>
            <strong>Open free-play editor →</strong>
          </button>
          <button
            className="is-secondary"
            onClick={() => state.act("Opened interaction docs placeholder")}
            type="button"
          >
            <span>Understand the contract</span>
            <strong>Read the docs ↗</strong>
          </button>
          <small>Placeholder destinations for the final demo</small>
        </div>
      </aside>

      <section className="b-main">
        <header className="b-header">
          <div>
            <p className="prototype-eyebrow">
              SCENARIO {fixtureIndex + 1} OF {fixtures.length}
            </p>
            <div className="b-title-row">
              <h1>{state.fixture.title}</h1>
              <OutcomeBadge fixture={state.fixture} />
            </div>
            <p>{state.fixture.summary}</p>
          </div>
        </header>

        <div className="b-steps">
          <section className="b-step b-route-step">
            <span className="b-step-number">1</span>
            <div>
              <p className="prototype-kicker">Wire one semantic intention</p>
              <h2>Use the control surface your host needs</h2>
              <div className="b-route-picker">
                <strong>Compare host wiring</strong>
                <RouteButtons state={state} />
                <span>
                  Changing tabs only changes the illustrative adapter example.
                </span>
              </div>
              <div className="b-code-example">
                <div>
                  <span>{state.route} adapter</span>
                  <small>illustrative pseudocode</small>
                </div>
                <pre>{routeExample[state.route]}</pre>
                <p>
                  Every route calls the same semantic operation. The host owns
                  shortcut and toolbar choices.
                </p>
              </div>
            </div>
          </section>

          <section className="b-step b-integrated-step">
            <span className="b-step-number">2</span>
            <div>
              <p className="prototype-kicker">
                Exercise one connected scenario
              </p>
              <h2>Review the proposal and inspect its observable result</h2>
              <p className="b-step-explainer">
                The document, operation outcome, and interchange artifacts are
                synchronized views of the same selected proposal.
              </p>

              <div className="b-proposal-toolbar b-shared-proposal">
                <div>
                  <span>Selected proposal</span>
                  <strong>{state.fixture.proposal}</strong>
                </div>
                <div>
                  <button
                    aria-label={
                      isDraft
                        ? "Finalize active draft"
                        : "Accept selected proposal"
                    }
                    onClick={() =>
                      state.act(
                        isDraft
                          ? "Finalized active draft"
                          : "Accepted selected proposal",
                      )
                    }
                    title={
                      isDraft
                        ? "Finalize active draft"
                        : "Accept selected proposal"
                    }
                    type="button"
                  >
                    ✓
                  </button>
                  <button
                    aria-label={
                      isDraft
                        ? "Discard active draft"
                        : "Reject selected proposal"
                    }
                    onClick={() =>
                      state.act(
                        isDraft
                          ? "Discarded active draft"
                          : "Rejected selected proposal",
                      )
                    }
                    title={
                      isDraft
                        ? "Discard active draft"
                        : "Reject selected proposal"
                    }
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="b-integrated-grid">
                <aside className="b-evidence-pane">
                  <div className="b-pane-heading">
                    <div>
                      <span>Proposal semantics</span>
                      <small>
                        Why the selected change is independently reviewable
                      </small>
                    </div>
                    <OutcomeBadge fixture={state.fixture} />
                  </div>
                  <div className="b-semantic-inspector">
                    <dl className="b-semantic-details">
                      <div>
                        <dt>Target</dt>
                        <dd>{state.fixture.semanticTarget}</dd>
                      </div>
                      <div>
                        <dt>Payload</dt>
                        <dd>{state.fixture.semanticPayload}</dd>
                      </div>
                    </dl>
                    <div className="b-resolution-meaning">
                      <div>
                        <strong>✓ {isDraft ? "Finalize" : "Accept"}</strong>
                        <span>{state.fixture.acceptMeaning}</span>
                      </div>
                      <div>
                        <strong>× {isDraft ? "Discard" : "Reject"}</strong>
                        <span>{state.fixture.rejectMeaning}</span>
                      </div>
                    </div>
                    <p className="b-latest-action">
                      Latest result: <strong>{state.lastAction}</strong>
                    </p>
                  </div>
                  <ArtifactPanel state={state} />
                </aside>

                <section className="b-document-pane">
                  <div className="b-pane-heading b-document-heading">
                    <div>
                      <span>Document projection</span>
                      <small>Review is editable in the final demo</small>
                    </div>
                    <ProjectionButtons state={state} />
                  </div>
                  <div className="b-projection-context">
                    <strong>Outcome previews do not create new edits.</strong>
                    <span>
                      All accepted and Accepted state are read-only. This
                      throwaway layout prototype uses static document text.
                    </span>
                  </div>
                  <div className="prototype-paper b-paper">
                    <DocumentProjection state={state} />
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function VariantC({ state }: { state: PrototypeState }) {
  return (
    <main className="variant-c">
      <header className="c-topbar">
        <div>
          <strong>lexical-review</strong>
          <span>/ capability instrument panel</span>
        </div>
        <div className="prototype-nonnormative">Non-normative demo shell</div>
      </header>

      <section className="c-layout">
        <section className="c-document-column">
          <div className="c-command-row">
            <label>
              <span>Fixture</span>
              <select
                onChange={(event) => state.setFixtureId(event.target.value)}
                value={state.fixture.id}
              >
                {fixtures.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.title}
                  </option>
                ))}
              </select>
            </label>
            <RouteButtons state={state} />
            <button
              className="prototype-primary"
              onClick={() => state.act("Executed current command")}
              type="button"
            >
              Replay
            </button>
          </div>
          <div className="c-document-heading">
            <div>
              <p className="prototype-eyebrow">LIVE REVIEW PROJECTION</p>
              <h1>Launch readiness brief</h1>
            </div>
            <ProjectionButtons state={state} />
          </div>
          <article className="prototype-paper c-paper">
            <p className="c-lead">
              Operational decisions for the next release.
            </p>
            <div className="c-marked">
              <DocumentProjection state={state} />
            </div>
            <p>
              Owners can inspect each finalized proposal without transferring
              focus or selection ownership away from Lexical.
            </p>
          </article>
          <div className="c-statusline">
            <span>Selection: paragraph 2 · accepted side</span>
            <span>
              Draft:{" "}
              {state.fixture.proposal.includes("draft") ? "active" : "none"}
            </span>
            <span>Finalized: 4</span>
          </div>
        </section>

        <aside className="c-instruments">
          <section className="c-proposal-list">
            <div className="c-panel-title">
              <div>
                <p className="prototype-kicker">Document order</p>
                <h2>Proposals</h2>
              </div>
              <span>4 pending</span>
            </div>
            {["p-104 · insertion", "p-105 · replacement", "p-106 · split"].map(
              (proposal, index) => (
                <button
                  className={index === 0 ? "is-active" : ""}
                  key={proposal}
                  onClick={() =>
                    state.act(`Inspected ${proposal.split(" · ")[0]}`)
                  }
                  type="button"
                >
                  <span>{proposal}</span>
                  <small>pending</small>
                </button>
              ),
            )}
            <div className="c-resolve-bar">
              <button
                onClick={() => state.act("Accepted selected proposal")}
                type="button"
              >
                Accept
              </button>
              <button
                onClick={() => state.act("Rejected selected proposal")}
                type="button"
              >
                Reject
              </button>
              <button
                onClick={() => state.act("Navigated to next proposal")}
                type="button"
              >
                Next ↓
              </button>
            </div>
          </section>

          <section className="c-operation-log">
            <div className="c-panel-title">
              <div>
                <p className="prototype-kicker">Semantic trace</p>
                <h2>Operation</h2>
              </div>
              <OutcomeBadge fixture={state.fixture} />
            </div>
            <ol>
              <li>
                <span>01</span> {state.route} input claimed
              </li>
              <li>
                <span>02</span> intention normalized
              </li>
              <li>
                <span>03</span> target validated
              </li>
              <li
                className={
                  state.fixture.outcome === "refused" ? "is-warning" : ""
                }
              >
                <span>04</span> {state.fixture.outcomeReason}
              </li>
            </ol>
          </section>

          <ArtifactPanel state={state} />
        </aside>
      </section>
      <PrototypeStateStrip state={state} />
    </main>
  );
}

function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: VariantKey;
  onChange: (variant: VariantKey) => void;
}) {
  const variants = useMemo(() => ["A", "B", "C"] as const, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const currentIndex = variants.indexOf(current);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      onChange(
        variants[
          (currentIndex + direction + variants.length) % variants.length
        ]!,
      );
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, onChange, variants]);

  const move = (direction: number) => {
    const currentIndex = variants.indexOf(current);
    onChange(
      variants[(currentIndex + direction + variants.length) % variants.length]!,
    );
  };

  return (
    <div className="prototype-switcher" aria-label="Prototype variant switcher">
      <button
        aria-label="Previous variant"
        onClick={() => move(-1)}
        type="button"
      >
        ←
      </button>
      <span>
        <strong>{current}</strong> — {variantNames[current]}
      </span>
      <button aria-label="Next variant" onClick={() => move(1)} type="button">
        →
      </button>
    </div>
  );
}

export default function CapabilityDemoPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  const state = usePrototypeState();

  const selectVariant = (nextVariant: VariantKey) => {
    const url = new URL(window.location.href);
    url.searchParams.set("prototype", "capability-demo");
    url.searchParams.set("variant", nextVariant);
    window.history.replaceState({}, "", url);
    setVariant(nextVariant);
    state.act(`Switched to variant ${nextVariant}`);
  };

  return (
    <div className="capability-demo-prototype">
      {variant === "A" && <VariantA state={state} />}
      {variant === "B" && <VariantB state={state} />}
      {variant === "C" && <VariantC state={state} />}
      <PrototypeSwitcher current={variant} onChange={selectVariant} />
    </div>
  );
}
