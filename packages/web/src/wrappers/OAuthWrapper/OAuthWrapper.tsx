import { GoogleOAuthProvider } from "@react-oauth/google";
import type { ReactNode } from "react";

interface IOAuthWrapper {
  children: ReactNode;
}

function OAuthWrapper(props: IOAuthWrapper) {
  const { children } = props;

  return (
    <>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
        {children}
      </GoogleOAuthProvider>
    </>
  );
}

export default OAuthWrapper;
