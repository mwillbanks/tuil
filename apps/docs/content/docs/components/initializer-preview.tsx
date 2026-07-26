export function InitializerPreview() {
  return (
    <div
      className="docs-terminal-preview"
      aria-label="tuil init preview"
      role="img"
    >
      <div className="docs-terminal-chrome" aria-hidden="true">
        <span />
        <span />
        <span />
        <strong>tuil init</strong>
      </div>
      <div className="docs-terminal-body">
        <p className="docs-terminal-kicker">CREATE A TERMINAL APPLICATION</p>
        <div className="docs-terminal-step">
          <span>01</span>
          <div>
            <strong>Project name</strong>
            <code>my-tuil-app</code>
          </div>
          <b>ready</b>
        </div>
        <div className="docs-terminal-step is-active">
          <span>02</span>
          <div>
            <strong>Choose a template</strong>
            <code>dashboard</code>
          </div>
          <b>selecting</b>
        </div>
        <div className="docs-terminal-options">
          <span>◉ Minimal</span>
          <span className="is-selected">◉ Dashboard</span>
          <span>◉ Workflow</span>
        </div>
        <div className="docs-terminal-footer">
          <span>↑↓ navigate</span>
          <span>enter continue</span>
          <span>esc cancel</span>
        </div>
      </div>
    </div>
  );
}
