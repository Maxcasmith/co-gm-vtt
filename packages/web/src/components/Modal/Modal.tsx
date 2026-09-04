import { useEffect, type ReactNode } from "react";
import "./Modal.css";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Modal(props: ModalProps) {
  const { children, isOpen, onClose } = props;

  useEffect(() => {
    if (!isOpen || !onClose) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return <></>;

  return (
    <>
      <div className="modal--wrapper">
        <div className="modal--inner--wrapper">{children}</div>
      </div>
    </>
  );
}
