import "./Toast.css";
export const ToastVariants = {
  SUCCESS: "success",
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
} as const;

export type ToastInterface = (typeof ToastVariants)[keyof typeof ToastVariants];

export interface ToastPayload {
  message: string;
  variant: ToastInterface;
}

export function Toast(props: ToastPayload) {
  const { message, variant } = props;

  const className = getClassName(variant);

  return (
    <div className={className}>
      <p>{message}</p>
    </div>
  );
}

function getClassName(variant: ToastInterface) {
  const className = ["toast--wrapper"];

  switch (variant) {
    case "success":
      className.push("toast--variant--success");
      break;
    case "error":
      className.push("toast--variant--error");
      break;
    case "warning":
      className.push("toast--variant--warning");
      break;
    case "info":
    default:
      className.push("toast--variant--info");
      break;
  }

  return className.join(" ");
}
