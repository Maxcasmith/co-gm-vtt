import type { ReactNode } from "react";
import OAuthWrapper from "./OAuthWrapper/OAuthWrapper";
import ToasterWrapper from "./ToasterWrapper/ToasterWrapper";

interface IWrappers {
  children: ReactNode;
}

function Wrappers(props: IWrappers) {
  const { children } = props;

  return (
    <>
      <ToasterWrapper>
        <OAuthWrapper>{children}</OAuthWrapper>
      </ToasterWrapper>
    </>
  );
}

export default Wrappers;
