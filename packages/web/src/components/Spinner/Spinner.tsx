import "./Spinner.css";

export function Spinner() {
  return (
    <div className="spinner--wrapper">
      <div className="spinner--card">
        <div className="spinner--front" />
        <div className="spinner--back" />
      </div>
      <p className="spinner--text">Loading</p>
    </div>
  );
}
