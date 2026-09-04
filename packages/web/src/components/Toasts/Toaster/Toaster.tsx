import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Toast, type ToastInterface, type ToastPayload } from "../Toast/Toast";
import "./Toaster.css";

interface ToasterProps {
  children: ReactNode;
}

interface ToasterContextInterface {
  toast(message: string, variant: ToastInterface): void;
}

const ToasterContext = createContext<ToasterContextInterface>(undefined);

export function Toaster(props: ToasterProps) {
  const { children } = props;

  const [toasts, setToasts] = useState<ToastPayload[]>([]);

  useEffect(() => {
    console.log(toasts);
  }, [toasts]);

  const toast = (message: string, variant: ToastInterface) =>
    setToasts((t) => {
      const payload: ToastPayload = {
        message,
        variant,
      };

      t.push(payload);
      return [...t];
    });

  const values = {
    toast,
  };

  const renderToasts = toasts.map((t) => {
    return <Toast {...t} />;
  });

  return (
    <ToasterContext.Provider value={values}>
      <div className="toaster--wrapper">{renderToasts}</div>
      {children}
    </ToasterContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook colocated with its provider
export function useToaster() {
  return useContext(ToasterContext);
}
