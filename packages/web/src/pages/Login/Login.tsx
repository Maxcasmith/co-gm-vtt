import { ContinueWithGoogleButton } from "../../components/Button/ContinueWithGoogle/ContinueWithGoogle";
import "./Login.css";

export function Login() {
  return (
    <div className="login--page--wrapper">
      <div className="login--page--content">
        <h1 className="login--page--create--user--card--title">Untitled AI VTT</h1>
        <h3 className="login--page--subline">
          <span>Create</span>
          <span>Play</span>
          <span>Adventure</span>
        </h3>
        <div>
          <ContinueWithGoogleButton />
        </div>
      </div>
      <div className="login--page--logo">Untitled AI VTT</div>
    </div>
  );
}
