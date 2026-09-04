import type { ReactNode } from "react";
import { Toaster } from "../../components/Toasts/Toaster/Toaster";

interface ToasterWrapperProps {
  children: ReactNode;
}

export default function ToasterWrapper(props: ToasterWrapperProps) {
  const { children } = props;
  return <Toaster>{children}</Toaster>;
}
