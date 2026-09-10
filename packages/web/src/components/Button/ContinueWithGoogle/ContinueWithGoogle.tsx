import { Button } from "../Button";
import type { HTMLAttributes } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { useNavigate } from "react-router-dom";
import api from "../../../api/client";

interface ContinueWithGoogleButtonProps extends Omit<
  HTMLAttributes<HTMLButtonElement>,
  "onClick" | "color"
> {
  className?: string;
  /** Called with the OAuth code instead of the default sign-in-and-redirect-to-dashboard behavior. */
  onAuthenticated?: (code: string) => void;
}

export function ContinueWithGoogleButton(props: ContinueWithGoogleButtonProps) {
  const { onAuthenticated, ...rest } = props;
  const navigate = useNavigate();

  const googleLogin = useGoogleLogin({
    flow: "auth-code",
    scope:
      "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/youtube.upload",
    onSuccess: async (codeResponse) => {
      try {
        if (!codeResponse.code) {
          throw Error("Failed to sign in with google");
        }

        if (onAuthenticated) {
          onAuthenticated(codeResponse.code);
          return;
        }

        await api.auth.ssoGoogle({
          code: codeResponse.code,
          scope: codeResponse.scope,
        });

        navigate("/dashboard");
      } catch (error) {
        console.error("Login failed:", error);
        alert("Failed to sign in with Google");
      }
    },
    onError: (error) => {
      console.error("Google login error:", error);
      alert("Failed to sign in with Google");
    },
  });

  return (
    <Button className="rounded white" onClick={() => googleLogin()} {...rest}>
      Continue with Google
    </Button>
  );
}
