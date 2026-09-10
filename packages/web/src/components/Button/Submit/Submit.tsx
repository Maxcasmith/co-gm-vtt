import { Button } from "../Button";
import { useFormContext } from "../../Form/Form";
import type { HTMLAttributes, ReactNode } from "react";

interface SubmitButtonProps extends Omit<HTMLAttributes<HTMLButtonElement>, "color"> {
  children: ReactNode;
  className?: string;
}

export function Submit(props: SubmitButtonProps) {
  const { children, ...rest } = props;

  const formContext = useFormContext();

  if (!formContext) return <Button {...rest}>{children}</Button>;

  const { submit, formActive } = formContext;

  return (
    <Button disabled={!formActive} onClick={submit} {...rest}>
      {children}
    </Button>
  );
}
