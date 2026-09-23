interface Props {
  title: string;
  done: boolean;
  error: string;
  progressLines: string[];
  rawOutput: string;
  campaignId: string;
}

export default function GeneratingStep({ title, done, error, progressLines, rawOutput, campaignId }: Props) {
  return (
    <div className="create-step create-step-generating">
      <div className="modal-header">
        <h1 className="modal-title">{title}</h1>
        {!done && !error && <p className="modal-hint">Building your campaign — this may take a moment.</p>}
      </div>
      <pre className="stream-output stream-output-steps">
        {progressLines.join('\n') || 'Generating world…'}
      </pre>
      {rawOutput && (
        <pre className="stream-output stream-output-raw">{rawOutput}</pre>
      )}
      {error && <p className="modal-error">{error}</p>}
      {done && (
        <p className="modal-success">
          <strong>{campaignId}</strong> is ready to play.
        </p>
      )}
    </div>
  );
}
