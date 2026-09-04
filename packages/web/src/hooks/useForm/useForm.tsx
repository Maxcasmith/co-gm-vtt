import { useEffect, useReducer, useState } from "react";
import type z from "zod";

interface UseFormProps<G> {
  initialValue: G;
  submitAction: (form: G) => Promise<void>;
  validationRules?: z.ZodType;
}

interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

export function useForm<G extends object>({
  initialValue,
  submitAction,
  validationRules,
}: UseFormProps<G>) {
  const [formActive, setFormActive] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errors, setErrors] = useState<Map<string, string[]>>(new Map());
  const [form, setForm] = useReducer(
    (currentState: G, incoming: Partial<G>) => {
      return { ...currentState, ...incoming };
    },
    initialValue,
  );

  const activateForm = () => setFormActive(true);
  const submit = () => setIsSubmitting(true);

  // Deliberately keyed on isSubmitting alone — it's the trigger, not form/submitAction/
  // validationRules. The effect reads their current-render closure values when it fires;
  // adding them would rerun this on every keystroke instead of only on submit.
  useEffect(() => {
    if (!isSubmitting) return;

    (async () => {
      setErrors(new Map());
      setFormActive(false);
      try {
        if (validationRules) {
          validationRules.parse(form);
        }

        await submitAction(form);

        console.log("Complete request");
      } catch (err) {
        const issues = (err as { issues?: ZodIssueLike[] })?.issues;
        if (issues) {
          console.error(issues);
          const errMap = issues.reduce(
            (current: Map<string, string[]>, next: ZodIssueLike) => {
              current.set(String(next.path[0]), [next.message]);
              return current;
            },
            new Map<string, string[]>(),
          );

          setErrors(errMap);
        }
      } finally {
        setIsSubmitting(false);
        activateForm();
      }
    })();

    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitting]);

  return {
    form,
    setForm,
    formActive,
    activateForm,
    submit,
    isSubmitting,
    errors,
  };
}
